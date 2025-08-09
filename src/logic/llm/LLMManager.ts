import * as vscode from "vscode";
import { LLMService, Provider, getGroqModels } from "./LLMService";
import { logInfo, logWarn } from "./LLMLogger";

export class LLMManager {
  private static inMemoryCache: Map<string, string> = new Map();
  private static inflight: Map<string, Promise<string>> = new Map();

  public static async isEnabled(context: vscode.ExtensionContext): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration("visor.llm");
    const enabled = cfg.get<boolean>("enabled", false);
    if (!enabled) return false;
    const provider = cfg.get<string>("provider", "openai") as Provider;
    const key = await context.secrets.get(LLMManager.secretKeyName(provider));
    return Boolean(key);
  }

  public static async enableLLM(context: vscode.ExtensionContext): Promise<void> {
    const providerPick = await vscode.window.showQuickPick(
      [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "Groq", value: "groq" },
      ],
      {
        title: "Choose LLM Provider",
        placeHolder: "Select the provider for rewriting node labels",
      }
    );
    if (!providerPick) return;
    const provider = providerPick.value as Provider;

    const apiKey = await vscode.window.showInputBox({
      title: `${providerPick.label} API Key`,
      placeHolder: "Enter your API key",
      ignoreFocusOut: true,
      password: true,
      validateInput: (val) => (!val ? "API key is required" : undefined),
    });
    if (!apiKey) return;

    await context.secrets.store(LLMManager.secretKeyName(provider), apiKey);
    await vscode.workspace.getConfiguration("visor.llm").update("provider", provider, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration("visor.llm").update("enabled", true, vscode.ConfigurationTarget.Global);

    // Select model as part of onboarding
    let suggestions: string[] = LLMService.getDefaultModels(provider);
    if (provider === "groq") {
      logInfo("Fetching Groq models during onboarding");
      const remote = await getGroqModels(apiKey);
      if (remote.length > 0) suggestions = remote;
    }
    const modelPick = await vscode.window.showQuickPick(
      [
        ...suggestions.map((m) => ({ label: m, value: m })),
        { label: "Custom...", value: "__custom__" },
      ],
      { title: "Choose LLM Model", placeHolder: suggestions[0] || "Enter a model" }
    );
    if (!modelPick) return;
    let model = modelPick.value;
    if (model === "__custom__") {
      const input = await vscode.window.showInputBox({ title: "Custom model", value: suggestions[0] || "", ignoreFocusOut: true });
      if (!input) return;
      model = input;
    }
    await vscode.workspace.getConfiguration("visor.llm").update("model", model, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Visor LLM enabled with ${providerPick.label} (${model}).`);
  }

  public static async changeModel(context: vscode.ExtensionContext): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("visor.llm");
    const provider = cfg.get<string>("provider", "openai") as Provider;
    let suggestions = LLMService.getDefaultModels(provider);
    if (provider === "groq") {
      const apiKey = await context.secrets.get(LLMManager.secretKeyName("groq"));
      if (apiKey) {
        const remote = await getGroqModels(apiKey);
        if (remote.length > 0) suggestions = remote;
      }
    }
    const current = cfg.get<string>("model", suggestions[0] || "");

    const pick = await vscode.window.showQuickPick(
      [
        ...suggestions.map((m) => ({ label: m, value: m })),
        { label: "Custom...", value: "__custom__" },
      ],
      { title: "Choose LLM Model", placeHolder: current }
    );
    if (!pick) return;
    let model = pick.value;
    if (model === "__custom__") {
      const input = await vscode.window.showInputBox({ title: "Custom model", value: current, ignoreFocusOut: true });
      if (!input) return;
      model = input;
    }
    await cfg.update("model", model, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Visor LLM model set to ${model}.`);
  }

  public static async resetCache(context: vscode.ExtensionContext): Promise<void> {
    LLMManager.inMemoryCache.clear();
    await context.globalState.update("visor.llm.cache", {});
    void vscode.window.showInformationMessage("Visor LLM cache cleared.");
  }

  public static async getAvailability(context: vscode.ExtensionContext): Promise<{ enabled: boolean; provider: Provider; model: string }>{
    const cfg = vscode.workspace.getConfiguration("visor.llm");
    const provider = cfg.get<string>("provider", "openai") as Provider;
    let model = cfg.get<string>("model", LLMService.getDefaultModels(provider)[0] || "");
    if (!model) {
      const fallback = LLMService.getDefaultModels(provider)[0];
      if (fallback) {
        model = fallback;
      }
    }
    const enabled = await this.isEnabled(context);
    return { enabled, provider, model };
  }

  public static async translateIfNeeded(
    context: vscode.ExtensionContext,
    mermaidSource: string
  ): Promise<string | null> {
    const { enabled, provider, model } = await this.getAvailability(context);
    const effectiveModel = model || (LLMService.getDefaultModels(provider)[0] || "");
    logInfo(`translateIfNeeded: enabled=${enabled} provider=${provider} model=${effectiveModel}`);
    if (!enabled) return null;
    const style = vscode.workspace.getConfiguration("visor.llm").get<string>("style", "concise");
    const language = vscode.workspace.getConfiguration("visor.llm").get<string>("language", "");
    const key = await context.secrets.get(this.secretKeyName(provider));
    if (!key) {
      logWarn(`No API key found for provider ${provider}`);
      return null;
    }

    const cacheKey = await LLMService.computeCacheKey(mermaidSource, provider, effectiveModel, style, language);
    logInfo(`Cache key ${cacheKey.substring(0,8)}...`);
    const persistent = context.globalState.get<Record<string, string>>("visor.llm.cache", {});
    if (cacheKey in persistent) {
      logInfo(`Cache hit: persistent`);
      this.inMemoryCache.set(cacheKey, persistent[cacheKey]);
      return persistent[cacheKey];
    }
    if (this.inMemoryCache.has(cacheKey)) {
      logInfo(`Cache hit: memory`);
      return this.inMemoryCache.get(cacheKey) || null;
    }
    if (this.inflight.has(cacheKey)) {
      logInfo(`Inflight join`);
      return this.inflight.get(cacheKey)!;
    }

    const promise = (async () => {
      logInfo(`LLM call dispatch`);
      const translated = await LLLMServiceInstance.translateLabels({
        mermaidSource,
        provider,
        model: effectiveModel,
        apiKey: key,
        style,
        language,
      });
      logInfo(`LLM call resolved: ${translated ? 'ok' : 'null'}`);
      if (!translated) return mermaidSource;
      this.inMemoryCache.set(cacheKey, translated);
      const updated = { ...persistent, [cacheKey]: translated };
      await context.globalState.update("visor.llm.cache", updated);
      return translated;
    })();

    this.inflight.set(cacheKey, promise);
    try {
      const result = await promise;
      return result;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private static secretKeyName(provider: Provider): string {
    return `visor.llm.${provider}.apiKey`;
  }
}

// Lazily create a single service instance
const LLLMServiceInstance = new LLMService();


