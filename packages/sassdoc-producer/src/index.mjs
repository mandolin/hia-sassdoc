import {
  SASSDOC_INPUT_KINDS,
  SASSDOC_OUTPUT_KINDS,
  SASSDOC_RUNNER_VERSION,
  runSassDoc
} from "@hia-doc/sassdoc-runner";

export const sassdocProducerDescriptor = Object.freeze({
  contract: "documentation-producer",
  contractVersion: "0.1.0-draft",
  id: "sassdoc",
  version: SASSDOC_RUNNER_VERSION,
  displayName: "SassDoc",
  inputKinds: [...SASSDOC_INPUT_KINDS],
  outputKinds: [...SASSDOC_OUTPUT_KINDS],
  capabilities: {
    sourceLinkage: true,
    incremental: false,
    watch: false
  }
});

export const sassdocProducer = Object.freeze({
  descriptor: sassdocProducerDescriptor,
  produce(request, context = {}) {
    return runSassDoc(request, context);
  }
});

export default sassdocProducer;
