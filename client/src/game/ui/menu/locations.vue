<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";

import { mapState } from "vuex";
import { Prop, Watch } from "vue-property-decorator";

import Game from "@/game/game.vue";

import { gameStore } from "@/game/store";
import { socket } from "@/game/api/socket";
import { coreStore } from "../../../core/store";
import { EventBus } from "../../event-bus";

@Component({
    computed: {
        ...mapState("game", ["IS_DM"]),
    },
})
export default class LocationBar extends Vue {
    @Prop() active!: boolean;

    @Watch("active")
    toggleActive(active: boolean): void {
        for (const expandEl of (<any>this.$refs.locations).$el.querySelectorAll(".player-collapse-content")) {
            const hEl = <HTMLElement>expandEl;
            if (this.expanded.includes(hEl.dataset.loc || "")) {
                if (active) {
                    expandEl.style.removeProperty("display");
                } else {
                    expandEl.style.display = "none";
                }
            }
        }
    }

    expanded: string[] = [];
    horizontalOffset = 0;

    getCurrentLocation(): string {
        return gameStore.locationName;
    }

    changeLocation(name: string): void {
        socket.emit("Location.Change", { location: name, users: [gameStore.username] });
        coreStore.setLoading(true);
    }

    get locations(): string[] {
        return gameStore.locations;
    }

    set locations(locations: string[]) {
        gameStore.setLocations({ locations, sync: true });
    }

    get playerLocations(): Map<string, string[]> {
        const map: Map<string, string[]> = new Map();
        for (const player of gameStore.players) {
            if (player.name === gameStore.username && gameStore.IS_DM) continue;
            if (!map.has(player.location)) map.set(player.location, []);
            map.get(player.location)!.push(player.name);
        }
        return map;
    }

    async createLocation(): Promise<void> {
        const value = await (<Game>this.$parent.$parent).$refs.prompt.prompt(
            `New location name:`,
            `Create new location`,
        );
        socket.emit("Location.New", value);
    }

    openLocationSettings(location: string): void {
        EventBus.$emit("LocationSettings.Open", location);
    }

    toggleExpanded(name: string): void {
        const idx = this.expanded.indexOf(name);
        if (idx < 0) this.expanded.push(name);
        else this.expanded.splice(idx, 1);
    }

    endLocationDrag(e: { item: HTMLDivElement }): void {
        e.item.style.removeProperty("transform");
    }

    endPlayersDrag(e: { item: HTMLDivElement; from: HTMLDivElement; to: HTMLDivElement }): void {
        e.item.style.removeProperty("transform");
        const fromLocation = e.from.dataset.loc!;
        const toLocation = e.to.dataset.loc!;
        if (toLocation === undefined || fromLocation === toLocation) return;
        const players = [];
        for (const player of gameStore.players) {
            if (player.location === fromLocation) {
                player.location = toLocation;
                players.push(player.name);
            }
        }
        const idx = this.expanded.findIndex(x => x === fromLocation);
        if (idx >= 0) {
            this.expanded.slice(idx, 1);
            this.expanded.push(toLocation);
        }
        e.item.remove();
        socket.emit("Location.Change", { location: toLocation, users: players });
    }

    endPlayerDrag(e: { item: HTMLDivElement; from: HTMLDivElement; to: HTMLDivElement }): void {
        e.item.style.removeProperty("transform");
        const fromLocation = e.from.dataset.loc!;
        const toLocation = e.to.dataset.loc!;
        if (toLocation === undefined || fromLocation === toLocation) return;
        const targetPlayer = e.item.textContent!.trim();
        for (const player of gameStore.players) {
            if (player.name === targetPlayer) {
                player.location = toLocation;
                socket.emit("Location.Change", { location: toLocation, users: [targetPlayer] });
                break;
            }
        }
    }

    doHorizontalScroll(e: WheelEvent): void {
        const el: HTMLElement = (<any>this.$refs.locations).$el;
        if (e.deltaY > 0) el.scrollLeft += 100;
        else el.scrollLeft -= 100;
        this.horizontalOffset = el.scrollLeft;
        this.fixDisplays(el);
    }

    doHorizontalScrollA(_e: WheelEvent): void {
        const el: HTMLElement = (<any>this.$refs.locations).$el;
        this.fixDisplays(el);
    }

    private fixDisplays(el: HTMLElement): void {
        for (const expandEl of el.querySelectorAll(".player-collapse-content")) {
            const hEl = <HTMLElement>expandEl;
            hEl.style.marginLeft = `-${el.scrollLeft}px`;
            if (this.expanded.includes(hEl.dataset.loc || "")) {
                if (hEl.style.display === "none") hEl.style.removeProperty("display");
            } else {
                continue;
            }
            if (hEl.getBoundingClientRect().right > window.innerWidth) {
                hEl.style.display = "none";
            }
        }
    }
}
</script>

<template>
    <div id="location-bar" v-if="IS_DM">
        <div id="create-location" title="Add new location" @click="createLocation">+</div>
        <draggable
            id="locations"
            v-model="locations"
            @end="endLocationDrag"
            handle=".drag-handle"
            @wheel.native="doHorizontalScroll"
            @scroll.native="doHorizontalScrollA"
            ref="locations"
        >
            <div class="location" v-for="location in locations" :key="location">
                <div
                    class="location-name"
                    @click="changeLocation(location)"
                    :class="{ 'active-location': getCurrentLocation() === location }"
                >
                    <div class="drag-handle"></div>
                    <div class="location-name-label">{{ location }}</div>
                    <div class="location-settings-icon" @click="openLocationSettings(location)">
                        <i class="fas fa-cog"></i>
                    </div>
                </div>
                <draggable
                    class="location-players"
                    v-show="playerLocations.has(location)"
                    group="players"
                    @end="endPlayersDrag"
                    handle=".player-collapse-header"
                    :data-loc="location"
                >
                    <div class="player-collapse-header">
                        Players
                        <div title="Show specific players" @click="toggleExpanded(location)">
                            <span v-show="expanded.includes(location)"><i class="fas fa-chevron-up"></i></span>
                            <span v-show="!expanded.includes(location)"><i class="fas fa-chevron-down"></i></span>
                        </div>
                    </div>
                    <draggable
                        class="player-collapse-content"
                        v-show="expanded.includes(location)"
                        :data-loc="location"
                        group="player"
                        @end="endPlayerDrag"
                    >
                        <div
                            class="player-collapse-item"
                            v-for="player in playerLocations.get(location)"
                            :key="player"
                            :data-loc="location"
                        >
                            {{ player }}
                        </div>
                    </draggable>
                    <draggable
                        class="location-players-empty"
                        v-show="!expanded.includes(location)"
                        group="player"
                        :data-loc="location"
                    ></draggable>
                </draggable>
                <draggable
                    class="location-players-empty"
                    v-show="!playerLocations.has(location)"
                    :group="{ name: 'empty-players', put: ['players', 'player'] }"
                    :data-loc="location"
                ></draggable>
            </div>
        </draggable>
    </div>
</template>

<style scoped>
#location-bar {
    --primary: #7c253e;
    --secondary: #9c455e;
    --primaryBG: #7c253e50;
    display: flex;
    grid-area: locations;
    border-bottom: solid 1px var(--secondary);
    background-color: var(--primaryBG);
    pointer-events: auto;
}

#locations {
    pointer-events: auto;
    display: grid;
    grid-auto-flow: column;
    grid-gap: 10px;
    overflow-y: hidden;
    /* overflow-x: auto; */

    scrollbar-width: thin;
    scrollbar-color: var(--secondary) var(--primary);
}

#locations::-webkit-scrollbar {
    height: 11px;
}
#locations::-webkit-scrollbar-track {
    background: var(--secondary);
    border-radius: 6px;
}
#locations::-webkit-scrollbar-thumb {
    background-color: var(--primary);
    border-radius: 6px;
}

#create-location {
    overflow: hidden;
    flex-shrink: 0;
    display: inline-grid;
    width: 85px;
    color: white;
    background-color: var(--secondary);
    font-size: 30px;
    place-items: center center;
    margin: 10px;
}

#create-location:hover {
    font-weight: bold;
    cursor: pointer;
    text-shadow: 0 0 20px rgba(0, 0, 0, 1);
}

.location {
    display: flex;
    margin-top: 10px;
    flex-direction: column;
    user-select: none;
}

.location-name {
    padding: 1em;
    color: #fca5be;
    background-color: var(--primary);
    display: flex;
    position: relative;
    align-items: center;
}

.location-name-label {
    flex-grow: 2;
}

.location-settings-icon {
    padding-left: 10px;
}

.location-settings-icon svg {
    transition: transform 0.8s ease-in-out;
}

.location-settings-icon:hover svg {
    transform: rotate(180deg);
    transform-origin: center center;
}

.drag-handle {
    width: 25px;
}

.drag-handle::before {
    position: absolute;
    top: 8px;
    content: ".";
    color: white;
    font-size: 20px;
    line-height: 20px;
    text-shadow: 0 5px white, 0 10px white, 5px 0 white, 5px 5px white, 5px 10px white, 10px 0 white, 10px 5px white,
        10px 10px white;
}

.drag-handle:hover,
.drag-handle *:hover {
    cursor: grab;
}

.location-players {
    margin-bottom: 0.5em;
    margin-left: 0.5em;
    margin-right: 0.5em;
    color: white;
    border-top: 0;
    display: flex;
    flex-direction: column;
    min-width: 150px;
}

.player-collapse-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5em 1em;
    border-bottom-left-radius: 5px;
    border-bottom-right-radius: 5px;
    background-color: var(--secondary);
}

.player-collapse-content {
    position: absolute;
    /* top: 15px; */
    margin-top: 35px;
}

.player-collapse-item {
    margin-top: 10px;
    padding: 0.5em 1em;
    border-radius: 5px;
    background-color: var(--secondary);
}

.active-location {
    color: white;
    background-color: var(--primary);
}

.location:hover .location-name {
    cursor: pointer;
    color: white;
    background-color: var(--primary);
}
</style>