import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import readline from "readline/promises";
import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private groq: Groq;
  private transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | null = null;
  private tools: Groq.Chat.Completions.ChatCompletionTool[] = [];

  constructor() {
    this.groq = new Groq({
      apiKey: GROQ_API_KEY,
    });

    this.mcp = new Client({
      name: "mcp-client",
      version: "1.0.0",
    });
  }

  //connecting to MCP server
  async connectToServer(serverScriptPath: string) {
  try {
    const isJs = serverScriptPath.endsWith(".js");
    const isPy = serverScriptPath.endsWith(".py");
    if (!isJs && !isPy) {
      throw new Error("Server script must be a .js or .py file");
    }
    const command = isPy
      ? process.platform === "win32"
        ? "python"
        : "python3"
      : process.execPath;

      //transport - STDIO
    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });
    await this.mcp.connect(this.transport); //connects to MCP server

    const toolsResult = await this.mcp.listTools();
   
    this.tools = toolsResult.tools.map((tool) => {
      return {
        type:'function',
        function: {
            name: tool.name,
            parameters: tool.inputSchema,
            description: tool.description as string,
          },
      };
    });
    console.log(
      "Connected to server with tools:",
       this.tools.map((tool) => tool.function?.name),
    );
  } catch (e) {
    console.log("Failed to connect to MCP server: ", e);
    throw e;
  }
}

//processing user query
async processQuery(query: string) {
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: query,
    },
  ];

  //llm call
  const response = await this.groq.chat.completions.create({
    model: "qwen/qwen3-32b",
      messages,
      tools: this.tools,
  });

  const finalText = [];
  const choice = response.choices[0];
  const assistantMessage = choice.message;

  if(assistantMessage){
    finalText.push(assistantMessage.content);
  }

  //check if tool call required
  if(assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0){
    messages.push(assistantMessage);

    for(const toolCall of assistantMessage.tool_calls){
        if(toolCall.type !== 'function') continue;

        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        finalText.push(`[Calling tool ${toolName} with args ${toolCall.function.arguments}]`);

        //calling tool - Through MCP server
       const result =  await this.mcp.callTool({
            name: toolName,
            arguments:toolArgs,
        })

        messages.push({
            role:'tool',
            tool_call_id:toolCall.id,
            content: JSON.stringify(result.content)
        })
    }

    const followUpresonse = await this.groq.chat.completions.create({
         model: "qwen/qwen3-32b",
        messages,
    })

    if(followUpresonse.choices[0].message.content){
        finalText.push(followUpresonse.choices[0].message.content);
    }
  }

  return finalText.join("\n");
}

async chatLoop() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\nMCP Client Started!");
    console.log("Type your queries or 'quit' to exit.");

    while (true) {
      const message = await rl.question("\nQuery: ");
      if (message.toLowerCase() === "/bye") {
        break;
      }
      const response = await this.processQuery(message);
      console.log("\n" + response);
    }
  } finally {
    rl.close();
  }
}

async cleanup() {
  await this.mcp.close();
}
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } catch (e) {
    console.error("Error:", e);
    await mcpClient.cleanup();
    process.exit(1);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();