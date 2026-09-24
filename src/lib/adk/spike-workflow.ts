import { FunctionTool, LlmAgent, RequestInput, Workflow, node } from "@google/adk";
import { z } from "zod";

// Technical spike only (S0–S9). Removed once the real care workflow is built.
export const SPIKE_MODEL = "gemini-3.5-flash-lite";

// S0: no apiKey is passed; ADK must pick up the key from the server environment.
const summarizer = new LlmAgent({
  name: "spike_summarizer",
  model: SPIKE_MODEL,
  instruction: "ユーザーの相談内容を日本語で1文に要約してください。",
});

// S3: pause the workflow and wait for human input.
const askUser = node(
  function* askUser() {
    yield new RequestInput({ message: "補足を1つ教えてください（Spike）" });
  },
  { name: "ask_user" },
);

// S4: runs only after the workflow is resumed with the user's reply.
const echoReply = node((_ctx: unknown, input: unknown) => ({ resumedWith: input }), { name: "echo_reply" });

export const spikeWorkflow = new Workflow({
  name: "spike_workflow",
  edges: [["START", summarizer, askUser, echoReply]],
});

// S8: FunctionTool + structured output on the same LlmAgent; counts model requests.
export function createSpikeToolWorkflow(onModelRequest: () => void) {
  const lookupServiceCode = new FunctionTool({
    name: "lookup_service_code",
    description: "介護サービス名から、デモ用のサービスコードを返します。",
    parameters: z.object({ serviceName: z.string() }),
    execute: ({ serviceName }) => ({ code: serviceName.includes("訪問介護") ? "110" : "unknown" }),
  });

  const toolAgent = new LlmAgent({
    name: "spike_tool_agent",
    model: SPIKE_MODEL,
    instruction:
      "必ず lookup_service_code ツールで「訪問介護」のサービスコードを調べ、その結果を出力スキーマに従って返してください。",
    tools: [lookupServiceCode],
    outputSchema: z.object({ serviceName: z.string(), code: z.string() }),
    beforeModelCallback: () => {
      onModelRequest();
      return undefined;
    },
  });

  return new Workflow({ name: "spike_tool_workflow", edges: [["START", toolAgent]] });
}
