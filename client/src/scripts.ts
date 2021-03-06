/**
 * This file is destined for utility functions / scripts that can be ran manually in the webconsole by for example the DM.
 */

import { layerManager } from "./game/layers/manager";
import { GlobalPoint } from "./game/geom";
import { BaseRect } from "./game/shapes/baserect";
import { Circle } from "./game/shapes/circle";
import { Line } from "./game/shapes/line";
import { Polygon } from "./game/shapes/polygon";
import { sendShapeSizeUpdate, sendShapePositionUpdate } from "./game/api/emits/shape/core";
import { gameStore } from "./game/store";
import { visibilityStore } from "./game/visibility/store";
import { floorStore } from "./game/layers/store";

/**
 * This function rescales all objects on the map
 *
 * @param factor the ratio used to rescale shape axis by
 */
function rescale(factor: number, sync: boolean): void {
    if (!Number.isFinite(factor)) {
        console.error("Provided factor is not a valid number.");
        return;
    }
    if (sync === undefined) sync = false;
    if (!gameStore.IS_DM) {
        console.warn("You must be a DM to perform this operation.");
        return;
    }
    const shapes = [...layerManager.UUIDMap.values()];
    for (const shape of shapes) {
        if (shape.preventSync) continue;
        (<any>shape)._refPoint = new GlobalPoint(shape.refPoint.x * factor, shape.refPoint.y * factor);

        if (shape.type === "rect" || shape.type === "assetrect") {
            (<BaseRect>shape).w *= factor;
            (<BaseRect>shape).h *= factor;
        } else if (shape.type === "circle" || shape.type === "circulartoken") {
            (<Circle>shape).r *= factor;
        } else if (shape.type === "line") {
            (<Line>shape).endPoint = new GlobalPoint(
                (<Line>shape).endPoint.x * factor,
                (<Line>shape).endPoint.y * factor,
            );
        } else if (shape.type === "polygon") {
            (<Polygon>shape)._vertices = (<Polygon>shape)._vertices.map(
                v => new GlobalPoint(v.x * factor, v.y * factor),
            );
        }
        if (sync && shape.type !== "polygon") sendShapeSizeUpdate({ shape, temporary: false });
    }
    for (const floor of floorStore.floors) {
        visibilityStore.recalculateVision(floor.id);
        visibilityStore.recalculateMovement(floor.id);
    }
    layerManager.invalidateAllFloors();
    if (sync) {
        sendShapePositionUpdate(shapes, false);
        console.log("Changes should be synced now. Refresh your page to make sure everything works accordingly.");
    } else {
        console.log(
            "If everything looks ok and you want to sync these changes to the server, hard refresh your page and rerun the script with the sync parameter set to true. e.g. rescale(5/7, true)",
        );
    }
}

export function registerScripts(): void {
    (<any>window).rescale = rescale;
}
