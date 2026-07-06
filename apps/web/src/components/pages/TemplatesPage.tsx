import type { Blueprint } from "@cyflow/shared";
import { useStore } from "../../store/appStore";
import { ModuleIcon } from "../ModuleIcon";
import { Button } from "../ui";
import { deriveModules } from "../../scenario/model";

interface Template {
  name: string;
  description: string;
  blueprint: Blueprint;
}

const TEMPLATES: Template[] = [
  {
    name: "Webhook → Slack alert",
    description: "Post an instant Slack message when a webhook fires.",
    blueprint: {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "slack", operation: "send_message", kind: "action", params: { channel: "#alerts", text: "{{1.body}}" }, next: null },
      ],
    },
  },
  {
    name: "Enrich lead with AI → email",
    description: "Summarise an incoming lead with OpenAI and send it via Gmail.",
    blueprint: {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "openai", operation: "create_completion", kind: "action", params: { model: "gpt-4o-mini", prompt: "Summarise {{1.body}}" }, next: "3" },
        { id: "3", app: "gmail", operation: "send_email", kind: "action", params: { to: "team@acme.dev", subject: "New lead", body: "{{2.content}}" }, next: null },
      ],
    },
  },
  {
    name: "Iterate list → append to Sheet",
    description: "Split an array and append each item as a Google Sheets row.",
    blueprint: {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "flow", operation: "iterator", kind: "iterator", params: { array: "{{1.body.items}}" }, next: "3" },
        { id: "3", app: "sheets", operation: "append_row", kind: "action", params: { spreadsheetId: "SHEET", range: "A1" }, next: null },
      ],
    },
  },
];

export function TemplatesPage() {
  const store = useStore();

  const use = (t: Template) => {
    const id = store.createScenario();
    store.updateScenario(id, { name: t.name, blueprint: t.blueprint });
  };

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Templates</h1>
          <p>Start from a pre-built scenario and customise it.</p>
        </div>
      </div>

      <div className="cards">
        {TEMPLATES.map((t) => {
          const modules = deriveModules(t.blueprint);
          return (
            <div className="scard glass" key={t.name}>
              <div className="scard__top">
                <div className="scard__chain">
                  {modules.map((m) => (
                    <div className="scard__mini" key={m.node.id}>
                      <ModuleIcon app={m.node.app} operation={m.node.operation} sw={1.8} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="scard__title">{t.name}</div>
              <div className="scard__meta">
                <span>{t.description}</span>
              </div>
              <div className="scard__foot">
                <Button variant="ghost" onClick={() => use(t)}>
                  Use template
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
