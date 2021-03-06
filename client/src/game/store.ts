import { AssetList } from "@/core/comm/types";
import { socket } from "@/game/api/socket";
import { Note } from "@/game/comm/types/general";
import { ServerShape } from "@/game/comm/types/shapes";
import { GlobalPoint, Vector } from "@/game/geom";
import { layerManager } from "@/game/layers/manager";
import { g2l, l2g } from "@/game/units";
import { zoomValue } from "@/game/utils";
import { rootStore } from "@/store";
import Vue from "vue";
import { getModule, Module, Mutation, VuexModule } from "vuex-module-decorators";
import { sendClientLocationOptions, sendClientOptions } from "./api/emits/client";
import { sendLocationOrder, sendLocationRemove } from "./api/emits/location";
import { sendRoomLock, sendRoomKickPlayer } from "./api/emits/room";
import { floorStore } from "./layers/store";

export const DEFAULT_GRID_SIZE = 50;

export interface LocationUserOptions {
    panX: number;
    panY: number;
    zoomFactor: number;
}

export interface Player {
    id: number;
    name: string;
    location: number;
    role: number;
}

export interface ClientOptions {
    gridColour: string;
    fowColour: string;
    rulerColour: string;
    invertAlt: boolean;
    gridSize: number;
}

export interface GameState extends ClientOptions {
    boardInitialized: boolean;
}

@Module({ dynamic: true, store: rootStore, name: "game", namespaced: true })
class GameStore extends VuexModule implements GameState {
    boardInitialized = false;

    locations: { id: number; name: string }[] = [];

    assets: AssetList = {};

    notes: Note[] = [];

    markers: string[] = [];

    IS_DM = false;
    FAKE_PLAYER = false;
    isLocked = false;
    username = "";
    roomName = "";
    roomCreator = "";
    invitationCode = "";
    players: Player[] = [];

    gridColour = "rgba(0, 0, 0, 1)";
    fowColour = "rgba(0, 0, 0, 1)";
    rulerColour = "rgba(255, 0, 0, 1)";
    panX = 0;
    panY = 0;
    gridSize = DEFAULT_GRID_SIZE;

    zoomDisplay = 0.5;
    // zoomFactor = 1;

    annotations: string[] = [];
    ownedtokens: string[] = [];
    _activeTokens: string[] = [];

    drawTEContour = false;

    clipboard: ServerShape[] = [];
    clipboardPosition: GlobalPoint = new GlobalPoint(0, 0);

    // Maps are not yet supported in Vue untill 3.X, so for now we're using a plain old object
    labels: { [uuid: string]: Label } = {};

    filterNoLabel = false;
    labelFilters: string[] = [];

    showUI = true;

    invertAlt = false;

    get zoomFactor(): number {
        const gf = gameStore.gridSize / DEFAULT_GRID_SIZE;
        return zoomValue(this.zoomDisplay) * gf;
    }

    get activeTokens(): string[] {
        if (this._activeTokens.length === 0) return this.ownedtokens;
        return this._activeTokens;
    }

    get screenTopLeft(): GlobalPoint {
        return new GlobalPoint(-this.panX, -this.panY);
    }

    get screenCenter(): GlobalPoint {
        const halfScreen = new Vector(window.innerWidth / 2, window.innerHeight / 2);
        return l2g(g2l(this.screenTopLeft).add(halfScreen));
    }

    get isBoardInitialized(): boolean {
        return this.boardInitialized;
    }

    @Mutation
    setFakePlayer(value: boolean): void {
        this.FAKE_PLAYER = value;
        this.IS_DM = !value;
        layerManager.invalidateAllFloors();
    }

    @Mutation
    setZoomDisplay(zoom: number): void {
        if (zoom === this.zoomDisplay) return;
        if (zoom < 0) zoom = 0;
        if (zoom > 1) zoom = 1;
        this.zoomDisplay = zoom;
        layerManager.invalidateAllFloors();
    }

    @Mutation
    setBoardInitialized(boardInitialized: boolean): void {
        this.boardInitialized = boardInitialized;
    }

    @Mutation
    toggleUnlabeledFilter(): void {
        this.filterNoLabel = !this.filterNoLabel;
    }

    @Mutation
    addLabel(label: Label): void {
        Vue.set(this.labels, label.uuid, label);
    }

    @Mutation
    setLabelFilters(filters: string[]): void {
        this.labelFilters = filters;
    }

    @Mutation
    setLabelVisibility(data: { user: string; uuid: string; visible: boolean }): void {
        if (!(data.uuid in this.labels)) return;
        this.labels[data.uuid].visible = data.visible;
    }

    @Mutation
    deleteLabel(data: { uuid: string; user: string }): void {
        if (!(data.uuid in this.labels)) return;
        const label = this.labels[data.uuid];
        for (const shape of layerManager.UUIDMap.values()) {
            const i = shape.labels.indexOf(label);
            if (i >= 0) {
                shape.labels.splice(i, 1);
                shape.layer.invalidate(false);
            }
        }
        Vue.delete(this.labels, data.uuid);
    }

    @Mutation
    setDM(isDM: boolean): void {
        this.IS_DM = isDM;
    }

    @Mutation
    setUsername(username: string): void {
        this.username = username;
    }

    @Mutation
    setRoomName(name: string): void {
        this.roomName = name;
    }

    @Mutation
    setRoomCreator(name: string): void {
        this.roomCreator = name;
    }

    @Mutation
    setInvitationCode(code: string): void {
        this.invitationCode = code;
    }

    @Mutation
    newNote(data: { note: Note; sync: boolean }): void {
        this.notes.push(data.note);
        if (data.sync) socket.emit("Note.New", data.note);
    }

    @Mutation
    newMarker(data: { marker: string; sync: boolean }): void {
        const exists = this.markers.some(m => m === data.marker);
        if (!exists) {
            this.markers.push(data.marker);
            if (data.sync) socket.emit("Marker.New", data.marker);
        }
    }

    @Mutation
    removeMarker(data: { marker: string; sync: boolean }): void {
        this.markers = this.markers.filter(m => m !== data.marker);
        if (data.sync) socket.emit("Marker.Remove", data.marker);
    }

    @Mutation
    jumpToMarker(marker: string): void {
        const shape = layerManager.UUIDMap.get(marker);
        if (shape == undefined) return;
        const nh = window.innerWidth / this.gridSize / zoomValue(this.zoomDisplay) / 2;
        const nv = window.innerHeight / this.gridSize / zoomValue(this.zoomDisplay) / 2;
        this.panX = -shape.refPoint.x + nh * this.gridSize;
        this.panY = -shape.refPoint.y + nv * this.gridSize;
        sendClientLocationOptions();
        layerManager.invalidateAllFloors();
    }

    @Mutation
    setAssets(assets: AssetList): void {
        this.assets = assets;
    }

    @Mutation
    setLocations(data: { locations: { id: number; name: string }[]; sync: boolean }): void {
        this.locations = data.locations;
        if (data.sync) sendLocationOrder(this.locations.map(l => l.id));
    }

    @Mutation
    removeLocation(id: number): void {
        const idx = this.locations.findIndex(l => l.id === id);
        if (idx >= 0) this.locations.splice(idx, 1);
        sendLocationRemove(id);
    }

    @Mutation
    updateZoom(data: { newZoomDisplay: number; zoomLocation: GlobalPoint }): void {
        if (data.newZoomDisplay === this.zoomDisplay) return;
        if (data.newZoomDisplay < 0) data.newZoomDisplay = 0;
        if (data.newZoomDisplay > 1) data.newZoomDisplay = 1;
        const oldLoc = g2l(data.zoomLocation);
        this.zoomDisplay = data.newZoomDisplay;
        const newLoc = l2g(oldLoc);
        // Change the pan settings to keep the zoomLocation in the same exact location before and after the zoom.
        const diff = newLoc.subtract(data.zoomLocation);
        this.panX += diff.x;
        this.panY += diff.y;
        layerManager.invalidateAllFloors();
        sendClientLocationOptions();
    }

    @Mutation
    setGridColour(data: { colour: string; sync: boolean }): void {
        this.gridColour = data.colour;
        for (const floor of floorStore.floors) {
            layerManager.getGridLayer(floor)!.invalidate();
        }
        // eslint-disable-next-line @typescript-eslint/camelcase
        if (data.sync) sendClientOptions({ grid_colour: data.colour });
    }

    @Mutation
    setFOWColour(data: { colour: string; sync: boolean }): void {
        this.fowColour = data.colour;
        layerManager.invalidateAllFloors();
        // eslint-disable-next-line @typescript-eslint/camelcase
        if (data.sync) sendClientOptions({ fow_colour: data.colour });
    }

    @Mutation
    setRulerColour(data: { colour: string; sync: boolean }): void {
        this.rulerColour = data.colour;
        // eslint-disable-next-line @typescript-eslint/camelcase
        if (data.sync) sendClientOptions({ ruler_colour: data.colour });
    }

    @Mutation
    setPanX(x: number): void {
        this.panX = x;
    }

    @Mutation
    setPanY(y: number): void {
        this.panY = y;
    }

    @Mutation
    increasePanX(increase: number): void {
        this.panX += increase;
    }

    @Mutation
    increasePanY(increase: number): void {
        this.panY += increase;
    }

    @Mutation
    setGridSize(data: { gridSize: number; sync: boolean }): void {
        this.gridSize = data.gridSize;
        layerManager.invalidateAllFloors();
        // eslint-disable-next-line @typescript-eslint/camelcase
        if (data.sync) sendClientOptions({ grid_size: data.gridSize });
    }

    @Mutation
    updateNote(data: { note: Note; sync: boolean }): void {
        const actualNote = this.notes.find(n => n.uuid === data.note.uuid);
        if (actualNote === undefined) return;
        actualNote.title = data.note.title;
        actualNote.text = data.note.text;
        if (data.sync) socket.emit("Note.Update", actualNote);
    }

    @Mutation
    removeNote(data: { note: Note; sync: boolean }): void {
        this.notes = this.notes.filter(n => n.uuid !== data.note.uuid);
        if (data.sync) socket.emit("Note.Remove", data.note.uuid);
    }

    @Mutation
    toggleUI(): void {
        this.showUI = !this.showUI;
    }

    @Mutation
    setClipboard(clipboard: ServerShape[]): void {
        this.clipboard = clipboard;
    }

    @Mutation
    setClipboardPosition(position: GlobalPoint): void {
        this.clipboardPosition = position;
    }

    @Mutation
    setActiveTokens(tokens: string[]): void {
        this._activeTokens = tokens;
        layerManager.invalidateLightAllFloors();
    }

    @Mutation
    addActiveToken(token: string): void {
        this._activeTokens.push(token);
        layerManager.invalidateLightAllFloors();
    }

    @Mutation
    removeActiveToken(token: string): void {
        if (this._activeTokens.length === 0) {
            this._activeTokens = [...this.ownedtokens];
        }
        this._activeTokens.splice(this._activeTokens.indexOf(token), 1);
        layerManager.invalidateLightAllFloors();
    }

    @Mutation
    setPlayers(players: Player[]): void {
        this.players = players;
    }

    @Mutation
    addPlayer(player: Player): void {
        this.players.push(player);
    }

    @Mutation
    updatePlayer(data: { player: string; location: number }): void {
        for (const player of this.players) {
            if (player.name === data.player) {
                player.location = data.location;
            }
        }
    }

    @Mutation
    kickPlayer(playerId: number): void {
        sendRoomKickPlayer(playerId);
        this.players = this.players.filter(p => p.id !== playerId);
    }

    @Mutation
    setIsLocked(data: { isLocked: boolean; sync: boolean }): void {
        this.isLocked = data.isLocked;
        if (data.sync) {
            sendRoomLock(this.isLocked);
        }
    }

    @Mutation
    setInvertAlt(data: { invertAlt: boolean; sync: boolean }): void {
        this.invertAlt = data.invertAlt;
        // eslint-disable-next-line @typescript-eslint/camelcase
        if (data.sync) sendClientOptions({ invert_alt: data.invertAlt });
    }

    @Mutation
    clear(): void {
        this.ownedtokens = [];
        this.annotations = [];
        this.notes = [];
        this.markers = [];
        this.boardInitialized = false;
    }
}

export const gameStore = getModule(GameStore);
