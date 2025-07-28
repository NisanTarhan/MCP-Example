import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { select, input, confirm } from "@inquirer/prompts";
import {
  Tool,
  ResourceTemplate,
  Prompt,
  PromptMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { generateText, jsonSchema, ToolSet } from "ai";

const client = new Client({
  name: "test-mcp-client",
  version: "1.0.0",
  capabilities: { sampling: {} },
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/server.js"],
  stderr: "ignore", // Sunucudaki bir hata konsolu çıktısını client tarafında görmezden gel
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  await client.connect(transport);
  const [{ tools }, { prompts }, { resources }, { resourceTemplates }] =
    await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
      client.listResourceTemplates(),
    ]);

  console.log("Your MCP Server is running!");
  while (true) {
    // Main menu
    const option = await select({
      message: "What would you like to do?",
      choices: ["Query", "Tools", "Resources", "Prompts"],
    }); //Komut satırı içinde select seçeneği olması için

    switch (option) {
      case "Tools":
        const toolName = await select({
          message: "Select a tool to use:",
          choices: tools.map((tool) => ({
            name: tool.annotations?.title || tool.name,
            value: tool.name,
            description: tool.description,
          })),
        });
        const tool = tools.find((tool) => tool.name === toolName);
        if (!tool) {
          console.error("Tool not found");
          continue;
        } else {
          await getTool(tool);
        }
        break;
      case "Resources":
        const resourceUri = await select({
          message: "Select a resource",
          choices: [
            ...resources.map((resource) => ({
              name: resource.name,
              value: resource.uri,
              description: resource.description,
            })),
            ...(resourceTemplates as ResourceTemplate[]).map((template) => ({
              name: template.name,
              value: template.uriTemplate,
              description: template.description,
            })),
          ],
        });
        const uri =
          resources.find((resource) => resource.uri === resourceUri)?.uri ??
          (resourceTemplates as ResourceTemplate[]).find(
            (resourceTemplate) => resourceTemplate.uriTemplate === resourceUri
          )?.uriTemplate;
        if (uri == null) {
          console.error("Resource not found.");
        } else {
          await getResource(uri);
        }
        break;
      case "Prompts":
        const promptName = await select({
          message: "Select a prompt",
          choices: (prompts as Prompt[]).map((prompt) => ({
            name: prompt.name,
            value: prompt.name,
            description: prompt.description,
          })),
        });
        const prompt = (prompts as Prompt[]).find((p) => p.name === promptName);
        if (prompt == null) {
          console.error("Prompt not found.");
        } else {
          await getPrompt(prompt);
        }
        break;
      case "Query":
        await handleQuery(tools);
    }
  }
}

async function getTool(tool: Tool) {
  // Eğer parametreler varsa, bunların her birini döngüye al ve ihtiyacımız olan tüm farklı bilgiler için bir key ve bir value al.
  const args: Record<string, string> = {};
  const parameters = Object.entries(tool.inputSchema.properties || {});

  // Serverda tanımlanan parametrelerin her birini döngüye alır. Her bir parametre için kullanıcağıcıdan input ister ve beraberinde value tipini de belirtir.
  for (const [key, value] of parameters) {
    args[key] = await input({
      message: `Enter value for ${key} (${(value as { type: string }).type}):`,
    });
  }

  const result = await client.callTool({
    name: tool.name,
    arguments: args,
  });

  console.log("Tool result:", (result.content as [{ text: string }])[0].text);
}

async function getResource(uri: string) {
  let finalUri = uri;
  const paramMatches = uri.match(/{([^}]+)}/g);

  if (paramMatches != null) {
    for (const paramMatch of paramMatches) {
      const paramName = paramMatch.replace("{", "").replace("}", "");
      const paramValue = await input({
        message: `Enter value for ${paramName}:`,
      });
      finalUri = finalUri.replace(paramMatch, paramValue);
    }
  }

  const res = await client.readResource({
    uri: finalUri,
  });

  console.log(
    JSON.stringify(JSON.parse(res.contents[0].text as string), null, 2)
  );
}

async function getPrompt(prompt: Prompt) {
  const args: Record<string, string> = {};
  const promptArgs = prompt.arguments || [];
  for (const arg of promptArgs) {
    args[arg.name] = await input({
      message: `Enter value for ${arg.name}:`,
    });
  }

  const response = await client.getPrompt({
    name: prompt.name,
    arguments: args,
  });

  // response birden fazla mesaj içerebilir. Önemli olan, bu mesajların AI chatbot içerisinde kullanıldığından emin olmaktır.
  for (const message of response.messages) {
    console.log(await getServerMessagePrompt(message));
  }
}

async function getServerMessagePrompt(message: PromptMessage) {
  if (message.content.type !== "text") return; // Sadece metin içeren mesajları destekliyoruz.

  console.log(message.content.text); // Kullanıcı prompt'un ne olduğunu görebilir.
  const run = await confirm({
    message: "Would you like to run the above prompt",
    default: true,
  });

  if (!run) return;

  const { text } = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: message.content.text,
  });

  return text;
}

// Tool, Prompt ve Resource'ları AI'a aktararak, AI'ımızın Github Copilot gibi otomatik çalışmasını sağlayabiliriz.
async function handleQuery(tools: Tool[]) {
  const query = await input({ message: "Enter your query" });

  /* 
    Burada text dışında toolResults'a alıyoruz. Bunun sebebi AI'a "Bana şu isim, email, 
    adres ve telefon numarasıyla yeni bir kullanıcı yarat" dememizdir. O da "Bunun için 
    bir tool'um var" diyerek tool'un sonucunu dönecektir.
    */
  const { text, toolResults } = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: query,
    tools: tools.reduce(
      (obj, tool) => ({
        ...obj,
        [tool.name]: {
          description: tool.description,
          parameters: jsonSchema(tool.inputSchema),
          execute: async (args: Record<string, any>) => {
            // Bir tool'u çağırdığında ona ne yapması gerektiğini söylüyoruz.
            return await client.callTool({
              name: tool.name,
              arguments: args,
            });
          },
        },
      }),
      {} as ToolSet
    ),
  });

  console.log(
    // @ts-expect-error
    text || toolResults[0]?.result?.content[0]?.text || "No text generated."
  );
}

main();
