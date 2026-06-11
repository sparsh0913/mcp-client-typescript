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
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    /* await mcpClient.chatLoop(); */
  } catch (e) {
    console.error("Error:", e);
   /*  await mcpClient.cleanup();
    process.exit(1); */
  } finally {
   /*  await mcpClient.cleanup();
    process.exit(0); */
  }
}

main();