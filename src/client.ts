import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { select, input, confirm } from "@inquirer/prompts";
import { Tool, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";

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

      case "Query":
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

main();
