import { ArrowLeft, ChevronRight, Minus, Plus, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppSelect } from "../../components/AppSelect";
import ConfigTextEditor, { type ConfigTextEditorHandle } from "../../components/ConfigTextEditor";
import type { EditorDiagnosticSummary, McpServerSpec } from "../../types";

type Transport = "stdio" | "http";
interface KVPair { key: string; value: string; }

function recordToPairs(record: Record<string, string>): KVPair[] { return Object.entries(record).map(([key, value]) => ({ key, value })); }
function pairsToRecord(pairs: KVPair[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const pair of pairs) { const key = pair.key.trim(); if (key) record[key] = pair.value.trim(); }
  return record;
}

function PairEditor({ pairs, onChange, keyPlaceholder, valuePlaceholder }: { pairs: KVPair[]; onChange: (pairs: KVPair[]) => void; keyPlaceholder: string; valuePlaceholder: string }) {
  if (!pairs.length) return <button type="button" className="app-dynamic-input__create" onClick={() => onChange([{ key: "", value: "" }])}><Plus size={16} strokeWidth={2} aria-hidden="true" />添加</button>;
  return <div className="app-dynamic-input">{pairs.map((pair, index) => <div key={index} className="app-dynamic-input__item"><div className="app-dynamic-input__pair"><div className="app-input-focus-frame"><input className="app-input app-dynamic-input__input mono" placeholder={keyPlaceholder} value={pair.key} onChange={(event) => onChange(pairs.map((current, currentIndex) => currentIndex === index ? { ...current, key: event.target.value } : current))} /></div><div className="app-input-stepper app-input-focus-frame"><input className="app-input app-dynamic-input__input app-input-stepper__input mono" placeholder={valuePlaceholder} value={pair.value} onChange={(event) => onChange(pairs.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} /><div className="app-input-stepper__actions"><button type="button" className="app-input-stepper__action" aria-label="删除此行" onClick={() => onChange(pairs.filter((_current, currentIndex) => currentIndex !== index))}><Minus size={16} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="app-input-stepper__action" aria-label="在此行后添加" onClick={() => onChange([...pairs.slice(0, index + 1), { key: "", value: "" }, ...pairs.slice(index + 1)])}><Plus size={16} strokeWidth={2} aria-hidden="true" /></button></div></div></div></div>)}</div>;
}

function TimeoutInput({ value, onChange, placeholder }: { value: number | null; onChange: (value: number | null) => void; placeholder: string }) {
  return <div className="app-input-stepper app-input-focus-frame"><input className="app-input app-input-stepper__input" type="number" min={1} placeholder={placeholder} value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} /><div className="app-input-stepper__actions"><button type="button" className="app-input-stepper__action" aria-label="减少 1 秒" onClick={() => onChange(Math.max(1, (value ?? 1) - 1))}><Minus size={16} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="app-input-stepper__action" aria-label="增加 1 秒" onClick={() => onChange((value ?? 0) + 1)}><Plus size={16} strokeWidth={2} aria-hidden="true" /></button></div></div>;
}

interface McpEditProps {
  server: McpServerSpec | null;
  create?: boolean;
  onBack: () => void;
}

export default function McpEdit({ server, create = false, onBack }: McpEditProps) {
  const feedback = useFeedback();
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<Transport>(server?.url ? "http" : "stdio");
  const [command, setCommand] = useState(server?.command ?? "");
  const [argsText, setArgsText] = useState((server?.args ?? []).join("\n"));
  const [url, setUrl] = useState(server?.url ?? "");
  const [bearer, setBearer] = useState(server?.bearer_token_env_var ?? "");
  const [startupTimeout, setStartupTimeout] = useState<number | null>(server?.startup_timeout_sec ?? null);
  const [toolTimeout, setToolTimeout] = useState<number | null>(server?.tool_timeout_sec ?? null);
  const [envPairs, setEnvPairs] = useState<KVPair[]>(recordToPairs(server?.env ?? {}));
  const [headerPairs, setHeaderPairs] = useState<KVPair[]>(recordToPairs(server?.http_headers ?? {}));
  const [envHeaderPairs, setEnvHeaderPairs] = useState<KVPair[]>(recordToPairs(server?.env_http_headers ?? {}));
  const [tomlText, setTomlText] = useState("");
  const [initialToml, setInitialToml] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<EditorDiagnosticSummary>({ count: 0, firstLine: null });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const patchSeq = useRef(0);
  const parseSeq = useRef(0);
  const editorRef = useRef<ConfigTextEditorHandle>(null);

  const argsList = () => argsText.split("\n").map((line) => line.trim()).filter(Boolean);
  const formSpec = (): McpServerSpec => ({
    name: name.trim() || server?.name || "",
    enabled: server?.enabled ?? null,
    startup_timeout_sec: startupTimeout,
    tool_timeout_sec: toolTimeout,
    command: transport === "stdio" ? command.trim() || null : null,
    args: transport === "stdio" ? argsList() : [],
    env: transport === "stdio" ? pairsToRecord(envPairs) : {},
    url: transport === "http" ? url.trim() || null : null,
    bearer_token_env_var: transport === "http" ? bearer.trim() || null : null,
    http_headers: transport === "http" ? pairsToRecord(headerPairs) : {},
    env_http_headers: transport === "http" ? pairsToRecord(envHeaderPairs) : {},
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initial = create
          ? ""
          : (await api.getMcpServerToml(server?.name ?? "")) ?? await api.patchMcpFragment(`[mcp_servers.${server?.name ?? "server"}]\n`, formSpec());
        if (!cancelled) { setTomlText(initial); setInitialToml(initial); setInitialized(true); }
      } catch (error) { if (!cancelled) feedback.error(String(error)); }
    })();
    return () => { cancelled = true; };
    // initial props are fixed for the mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialized || (create && !name.trim())) return;
    const seq = ++patchSeq.current;
    void api.patchMcpFragment(tomlText, formSpec()).then((next) => {
      if (seq === patchSeq.current && next !== tomlText) setTomlText(next);
    }).catch(() => undefined);
  }, [argsText, bearer, command, envHeaderPairs, envPairs, headerPairs, initialized, name, startupTimeout, toolTimeout, transport, url]);

  useEffect(() => {
    if (!initialized || !tomlText.trim()) return;
    const seq = ++parseSeq.current;
    void api.parseMcpFragment(tomlText).then((spec) => {
      if (seq !== parseSeq.current) return;
      if (/^[A-Za-z0-9_-]+$/.test(spec.name)) setName(spec.name);
      setTransport(spec.url ? "http" : "stdio");
      setCommand(spec.command ?? "");
      setArgsText(spec.args.join("\n"));
      setUrl(spec.url ?? "");
      setBearer(spec.bearer_token_env_var ?? "");
      setStartupTimeout(spec.startup_timeout_sec);
      setToolTimeout(spec.tool_timeout_sec);
      setEnvPairs(recordToPairs(spec.env));
      setHeaderPairs(recordToPairs(spec.http_headers));
      setEnvHeaderPairs(recordToPairs(spec.env_http_headers));
    }).catch(() => undefined);
  }, [initialized, tomlText]);

  const dirty = initialized && tomlText.replace(/\r\n/g, "\n") !== initialToml.replace(/\r\n/g, "\n");

  const formatToml = async () => {
    if (formatting || saving) return;
    setFormatting(true);
    try {
      const formatted = await api.formatToml(tomlText);
      if (formatted === tomlText) feedback.info("格式无误，无需调整"); else { setTomlText(formatted); feedback.success("片段已格式化"); }
    } catch (error) { feedback.error(`格式化失败：${String(error)}`); }
    finally { setFormatting(false); }
  };

  const save = async () => {
    if (saving) return;
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) { feedback.error("名称只能包含字母、数字、下划线和连字符"); return; }
    if (transport === "stdio" && !command.trim()) { feedback.error("请填写启动命令"); return; }
    if (transport === "http" && !url.trim()) { feedback.error("请填写服务地址"); return; }
    if (transport === "http" && !/^https?:\/\//i.test(url.trim())) { feedback.error("服务地址必须以 http:// 或 https:// 开头"); return; }
    if (startupTimeout !== null && startupTimeout <= 0) { feedback.error("启动超时必须为正数（秒）"); return; }
    if (toolTimeout !== null && toolTimeout <= 0) { feedback.error("工具调用超时必须为正数（秒）"); return; }
    setSaving(true);
    try { await api.saveMcpServer(server?.name ?? null, formSpec(), tomlText); feedback.success("MCP 服务器已保存"); onBack(); }
    catch (error) { feedback.error(String(error)); }
    finally { setSaving(false); }
  };

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col" onKeyDown={(event) => { if (event.ctrlKey && event.key === "Enter") void save(); }}>
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">{create ? "新建 MCP 服务器" : "编辑 MCP 服务器"}</span>
        </button>
      </div>

      <div className="apple-edit-content">
        <div className="apple-group p-0">
          <div className="apple-panel-section">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="field-label mb-1.5">名称</div>
                <input className="app-input mono" maxLength={64} placeholder="例如：context7" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div>
                <div className="field-label mb-1.5">传输类型</div>
                <AppSelect value={transport} options={[{ label: "本地进程 (STDIO)", value: "stdio" as const }, { label: "远程服务 (HTTP)", value: "http" as const }]} onChange={setTransport} />
              </div>
            </div>
          </div>

          <div className="apple-panel-section">
            {transport === "stdio" ? <>
              <div>
                <div className="field-label mb-1.5">启动命令</div>
                <input className="app-input mono" placeholder="例如：npx 或 C:\\tools\\server.exe" value={command} onChange={(event) => setCommand(event.target.value)} />
              </div>
              <div className="mt-4">
                <div className="field-label mb-1.5">启动参数</div>
                <textarea className="app-input mono min-h-20" rows={2} placeholder="每行一个参数，例如：-y" value={argsText} onChange={(event) => setArgsText(event.target.value)} />
              </div>
            </> : <>
              <div>
                <div className="field-label mb-1.5">服务地址</div>
                <input className="app-input mono" placeholder="https://mcp.example.com/mcp" value={url} onChange={(event) => setUrl(event.target.value)} />
              </div>
              <div className="mt-4">
                <div className="field-label mb-1.5">Bearer Token 环境变量名（可选）</div>
                <input className="app-input mono" placeholder="例如：TAVILY_API_KEY" value={bearer} onChange={(event) => setBearer(event.target.value)} />
              </div>
            </>}
          </div>

          <div className="apple-panel-section">
            <div className={`apple-disclosure ${advancedOpen ? "apple-disclosure--open" : ""}`}>
              <button type="button" className="apple-disclosure__summary" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
                <ChevronRight className="apple-disclosure__icon" size={18} strokeWidth={2} aria-hidden="true" />
                <span className="field-subtitle">高级选项（环境变量 / 请求头 / 超时）</span>
              </button>
              <div className="apple-disclosure__content" aria-hidden={!advancedOpen} inert={!advancedOpen}>
                <div className="apple-disclosure__body">
                {transport === "stdio" ? <>
                  <div className="field-label mb-1.5">环境变量</div>
                  <PairEditor pairs={envPairs} onChange={setEnvPairs} keyPlaceholder="变量名" valuePlaceholder="值" />
                </> : <>
                  <div className="field-label mb-1.5">HTTP 请求头（固定值）</div>
                  <PairEditor pairs={headerPairs} onChange={setHeaderPairs} keyPlaceholder="Header 名" valuePlaceholder="值" />
                  <div className="field-label mb-1.5 mt-4">HTTP 请求头（值取自环境变量）</div>
                  <PairEditor pairs={envHeaderPairs} onChange={setEnvHeaderPairs} keyPlaceholder="Header 名" valuePlaceholder="环境变量名" />
                </>}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="field-label mb-1.5">启动超时（秒，可选）</div>
                    <TimeoutInput value={startupTimeout} onChange={setStartupTimeout} placeholder="默认 10" />
                  </div>
                  <div>
                    <div className="field-label mb-1.5">工具调用超时（秒，可选）</div>
                    <TimeoutInput value={toolTimeout} onChange={setToolTimeout} placeholder="默认 60" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="apple-panel-section">
            <div className="field-label mb-1.5 flex items-center gap-1.5">
              TOML 源码
              {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-accent" role="img" aria-label="有未保存的改动" title="有未保存的改动" /> : null}
            </div>
            <ConfigTextEditor ref={editorRef} value={tomlText} language="toml" placeholder="编辑 [mcp_servers.*] 片段，与上方表单双向同步。" onChange={setTomlText} onDiagnostics={setDiagnostics} />
          </div>
        </div>
      </div>

      <div className="apple-edit-toolbar apple-edit-toolbar--footer">
        {diagnostics.count > 0 ? <button type="button" className="mr-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-2.5 py-1 text-xs chip-danger" title="跳转到第一个错误" aria-live="polite" onClick={() => editorRef.current?.focusFirstDiagnostic()}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden="true" /><span className="truncate">{diagnostics.count} 个错误{diagnostics.firstLine !== null ? ` · 第 ${diagnostics.firstLine} 行` : ""}</span></button> : null}
        <button type="button" className="apple-action-button" disabled={formatting || saving} onClick={() => void formatToml()}>格式化</button>
        <button type="button" className="apple-action-button" onClick={onBack}>取消</button>
        <button type="button" className="apple-action-button app-button--primary" disabled={saving} onClick={() => void save()}><Save className="h-4 w-4" strokeWidth={2} />{saving ? "保存中…" : "保存"}</button>
      </div>
    </section>
  );
}
