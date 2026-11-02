import { resolveServiceConfiguration } from "./serviceConfiguration";

export const SERVICES = resolveServiceConfiguration({
  localOnly: __PS_LOCAL_ONLY__,
  localAi: __PS_LOCAL_AI__,
  singleFile: __PS_SINGLE_FILE__,
  tokenEndpoint: __PS_TOKEN_ENDPOINT__,
  publicAppUrl: __PS_PUBLIC_APP_URL__,
  assistantEndpoint: __PS_ASSISTANT_ENDPOINT__,
  source: __SDS_SERVICE_SELECTION__.source,
  configurationError: __SDS_SERVICE_SELECTION__.error,
});
