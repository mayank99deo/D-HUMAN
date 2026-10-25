// Runs the contour field off the main thread. The page transfers its canvas here and
// forwards size, visibility and pointer changes as messages.

import { createFieldRenderer, type FieldController, type FieldOptions } from "./renderer";

export type FieldMessage =
  | ({ type: "init"; canvas: OffscreenCanvas } & FieldOptions)
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "visible"; value: boolean }
  | { type: "hidden"; value: boolean }
  | { type: "reducedMotion"; value: boolean }
  | { type: "pointer" | "pulse"; x: number; y: number }
  | { type: "dispose" };

export type FieldReply = { type: "unavailable" };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FieldMessage>) => void) | null;
  postMessage(message: FieldReply): void;
};

let field: FieldController | null = null;
const unavailable = () => scope.postMessage({ type: "unavailable" });

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "init": {
      const { canvas, ...options } = data;
      field = createFieldRenderer(canvas, options, unavailable);
      if (!field) unavailable();
      break;
    }
    case "resize":
      field?.resize(data.width, data.height, data.dpr);
      break;
    case "visible":
      field?.setVisible(data.value);
      break;
    case "hidden":
      field?.setHidden(data.value);
      break;
    case "reducedMotion":
      field?.setReducedMotion(data.value);
      break;
    case "pointer":
      field?.pointer(data.x, data.y);
      break;
    case "pulse":
      field?.pulse(data.x, data.y);
      break;
    case "dispose":
      field?.dispose();
      field = null;
      break;
  }
};
