// onnxruntime-node 1.18 ships without its declaration file; its API is onnxruntime-common's.
declare module "onnxruntime-node" {
  export * from "onnxruntime-common";
}
