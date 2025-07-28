import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";

type UserType = {
  name: string;
  email: string;
  address: string;
  phone: string;
};

const server = new McpServer({
  name: "test-mcp-server",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
    prompts: {},
  },
});

// Tools
server.registerTool(
  "create-user",
  {
    title: "Create User",
    description: "Creates a new user with the provided details.",
    inputSchema: {
      name: z.string(),
      email: z.string(),
      address: z.string(),
      phone: z.string(),
    },
  },
  async (params) => {
    try {
      const id = await createUser(params);
      return {
        content: [{ type: "text", text: `User ${id} created successfully!` }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "Failed to save user!" }],
      };
    }
  }
);

async function createUser(user: UserType) {
  //experimental: JSON import which allows us to import user data to JSON file
  const users = await import("./data/users.json", {
    with: { type: "json" },
  }).then((mod) => mod.default);

  const id = users.length + 1;
  users.push({ id, ...user });

  await fs.writeFile("./src/data/users.json", JSON.stringify(users, null, 2));
  return id;
}

// Resource
server.registerResource(
  "users",
  "users://all",
  {
    title: "Users",
    description: "A collection of all users in the database.",
    mimeType: "application/json",
  },
  async (uri) => {
    const users = await import("./data/users.json", {
      with: { type: "json" },
    }).then((mod) => mod.default);

    return {
      contents: [
        {
          uri: uri.href, // Erişmeye çalıştığımız url
          text: JSON.stringify(users),
          mimeType: "application/json", // Data'nın nasıl kullanılacağını belirtir.
        },
      ],
    };
  }
);

// Resource Template
server.registerResource(
  "user-detail",
  new ResourceTemplate("users://{userId}/profile", { list: undefined }),
  {
    title: "User Detail",
    description: "Details of a specific user by ID.",
    mimeType: "application/json",
  },
  async (uri, { userId }) => {
    const users = await import("./data/users.json", {
      with: { type: "json" },
    }).then((mod) => mod.default);

    const userIdStr = Array.isArray(userId) ? userId[0] : userId;
    const user = users.find((user) => user.id === parseInt(userIdStr, 10));

    if (!user) {
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ error: "User not found" }),
            mimeType: "application/json",
          },
        ],
      };
    }

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(user),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// Prompt
server.registerPrompt(
  "create-user-prompt",
  {
    title: "Create User Prompt",
    description: "A prompt to create a new user.",
    argsSchema: {
      name: z.string(),
    },
  },
  ({ name }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please create a new user with the name ${name}. The user should have an email, address, and phone number.`,
          },
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
