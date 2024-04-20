const { sendEvent } = require("./supabase");
const findChromePath = require("find-chrome-path");
const webwhatsapp = require("whatsapp-web.js");

const { Client, LocalAuth, MessageMedia } = webwhatsapp;
const clients = new Map();
const axios = require("axios");
const getMessageMedia = (path) => {
  const media = MessageMedia.fromUrl(path);
  return media;
};

const startClient = async (clientId, channelId, channels, io, botId) => {
  // const store = await wwebjsStore();

  const { chrome, firefox, brave } = await findChromePath();
  const [browserPath] = process.execArgv;

  const executablePath = browserPath || brave || chrome || firefox;
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: clientId,
      // store: store,
      // backupSyncIntervalMs: 300000,
    }),
    // takeoverOnConflict: true,
    // takeoverTimeoutMs: 30000,
    qrMaxRetries: 10,
    puppeteer: {
      executablePath: process.env.IS_EXECUTABLE_PATH
        ? executablePath
        : undefined,
      headless: Boolean(process.env.IS_HEADLESS),
      args: [
        "--aggressive-cache-discard",
        "--disable-cache",
        "--disable-application-cache",
        "--disable-offline-load-stale-cache",
        "--disk-cache-size=0",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        // "--single-process", // <- this one doesn't works in Windows
        "--disable-gpu",
      ],
    },
  });

  clients.set(clientId, client);

  // Handle the error event
  client.on("error", (error) => {
    console.error(`Client has encountered an error: ${error}`);
  });
  client.on("ready", () => {
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: {
        type: "whatsapp_state",
        data: "CONNECTED",
        clientId,
        client_info: JSON.parse(JSON.stringify(clients.get(clientId)?.info)),
      },
    });
    console.log(`Client ${clientId} is ready!`);
  });

  client.on("message", async (message) => {
    io.to(channelId).emit("bot_message", { ...message, clientId });

    if (botId && message.body.trim().startsWith("ask")) {
      const [, question] = message.body.split("ask");

      try {
        const { data } = await axios.post("https://www.buddhiai.app/api/chat", {
          question: question.trim(),
          buddhiAppId: botId,
        });
        await client.sendMessage(message.from, data.text);
      } catch (err) {
        await client.sendMessage(
          message.from,
          "Something went wrong please try again"
        );
      }
    }
  });

  client.on("qr", (qr) => {
    console.log(`qr code generated for ${clientId}`);
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: { type: "qr_code", data: qr, clientId },
    });
  });

  // Listen for the session authenticated event
  client.on("authenticated", () => {
    console.log(`authenticated: ${clientId}`);
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: {
        type: "whatsapp_state",
        data: "authenticated",
        clientId,
      },
    });
  });

  client.on("auth_failure", () => {
    console.log(`auth_failure: ${clientId}`);
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: { type: "whatsapp_state", data: "auth_failure", clientId },
    });
  });

  client.on("change_state", (event) => {
    console.log(`change_state: ${clientId}`);
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: {
        type: "whatsapp_state",
        data: event,
        clientId,
        client_info: JSON.parse(JSON.stringify(clients.get(clientId)?.info)),
      },
    });
  });

  // Listen for the session log out event
  client.on("disconnected", async (reason) => {
    console.log(`disconnected: ${clientId} reason: ${reason}`);
    await destroyClient(clientId);
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: {
        type: "whatsapp_state",
        data: "disconnected",
        clientId,
        client_info: JSON.parse(JSON.stringify(clients.get(clientId)?.info)),
      },
    });
  });
  client.initialize();
};

async function destroyClient(clientId) {
  const client = clients.get(clientId);

  if (client) {
    try {
      await Promise.any([
        client.destroy(),
        new Promise((resolve) => setTimeout(resolve, 10000, "quick")),
      ]);
      console.log(`Client ${clientId} destroyed`);
    } catch (err) {
      console.log(err);
    } finally {
      clients.delete(clientId);
      console.log(`Client ${clientId} deleted`);
    }
  }
}

module.exports = {
  destroyClient,
  startClient,
  clients,
  getMessageMedia,
};
