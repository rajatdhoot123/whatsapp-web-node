const express = require("express");
require("dotenv").config();
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const { cloud_action_types } = require("./constant");
const {
  startClient,
  destroyClient,
  clients,
  getMessageMedia,
} = require("./client");
const {
  createChannel,
  sendEvent,
  updateCampaignStatus,
} = require("./supabase.js");
const Redis = require("ioredis");
const xlsx = require("xlsx");
const bodyParser = require("body-parser");
const instaroutes = require("./insta_routes");
const { requireAuth } = require("./middlewares.js");
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
const { read, utils } = xlsx;
const upload = multer();
const http = require("http");
app.all("*", requireAuth);

const server = http.createServer(app);

const redisClient = new Redis(process.env.RADIS_STRING, {
  tls: {
    rejectUnauthorized: false,
  },
});

const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    methods: ["GET", "POST", "OPTIONS"],
    origin:
      process.env.NODE_ENV === "development"
        ? [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
          ]
        : [
            "https://whatsapp.kwiktwik.com",
            "http://whatsapp.kwiktwik.com",
            "https://raghuveer.buddhiai.app",
            "https://whatsapp-git-insta-rajatdhoot.vercel.app",
          ],
    credentials: true,
  },
});
require("./socket")(io);

app.use("/instagram", instaroutes);

const channels = {};

const messageSending = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendMessage(clientId, userId) {
  const isActive = messageSending.get(clientId);
  const client = clients.get(clientId);
  const messageStatus = [];

  if (!client) {
    //Handle
    return;
  }
  if (isActive) {
    //Handle
    return;
  }

  const currentCampaign = await redisClient.lpop(clientId);
  if (!currentCampaign) {
    return;
  }

  const remaining = await redisClient.lrange(clientId, 0, -1);
  messageSending.set(clientId, true);
  const parseCampaign = JSON.parse(currentCampaign);
  await updateCampaignStatus({
    status: "started",
    campaign_id: parseCampaign.id,
    messages: parseCampaign.messages,
  });
  io.to(userId).emit("campaign_updates", {
    clientId: clientId,
    type: cloud_action_types.UPDATE_CAMPAIGN_STATUS,
    payload: { ...parseCampaign, status: "started" },
  });
  for (const [index, payload] of parseCampaign.messages.entries()) {
    const { number, message, media } = payload;
    if (!number) {
      // Handle No Number
    }
    if (media) {
      try {
        const formattedMedia = await getMessageMedia(media);
        await client.sendMessage(number + "@c.us", formattedMedia, {
          caption: message,
        });
        messageStatus[index] = { status: "success" };
      } catch (error) {
        messageStatus[index] = { status: "failed" };
        console.error(error.message);
      }
    } else {
      try {
        await client.sendMessage(number + "@c.us", message);
        messageStatus[index] = { status: "success" };
      } catch (error) {
        messageStatus[index] = { status: "failed" };
      }
    }
    io.to(userId).emit("campaign_updates", {
      clientId: clientId,
      type: cloud_action_types.UPDATE_CAMPAIGN_STATUS,
      payload: {
        ...parseCampaign,
        messages: parseCampaign.messages.map((message, index) => ({
          ...message,
          status: messageStatus[index].status || message.status,
        })),
        status: "started",
      },
    });
    await delay(parseCampaign.delay);
  }
  messageSending.delete(clientId);
  await updateCampaignStatus({
    status: "completed",
    campaign_id: parseCampaign.id,
    messages: parseCampaign.messages.map((message, index) => ({
      ...message,
      status: messageStatus[index].status || message.status,
    })),
  });
  io.to(userId).emit("campaign_updates", {
    clientId: clientId,
    type: cloud_action_types.UPDATE_CAMPAIGN_STATUS,
    payload: {
      ...parseCampaign,
      messages: parseCampaign.messages.map((message, index) => ({
        ...message,
        status: messageStatus[index].status || message.status,
      })),
      status: "completed",
    },
  });
  if (remaining.length) {
    sendMessage(clientId, userId);
  }
}

async function excelToJson(file) {
  const workbook = await read(file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const jsonObject = utils.sheet_to_json(workbook.Sheets[sheetName], {
    raw: false,
  });

  return jsonObject;
}

app.post("/path-to-base64", (req, res) => {
  const { path } = req.body;
  if (!fs.existsSync(path)) {
    return { error: "File not found" };
  }
  const fileBase64 = fs.readFileSync(path).toString("base64");
  return { file: fileBase64 };
});

// Receive message webhook for a specific client
app.post("/webhook/:clientId", (req, res) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);

  if (!client) {
    return res.status(404);
  }

  const message = req.body;

  // Do something with received message
});

app.post("/start-campaign/:clientId/:campaignId", async (req, res) => {
  const clientId = req.params.clientId;

  if (!clientId) {
    return res
      .json({ message: "Please send channel to send message" })
      .status(500);
  }
  const body = req.body;
  const userId = req.user.id;
  try {
    io.to(userId).emit("campaign_updates", {
      clientId: clientId,
      type: cloud_action_types.ADD_CAMPAIGN_TO_QUEUE,
      payload: { ...body, status: "queue" },
    });
    await redisClient.rpush(clientId, JSON.stringify(body));
    sendMessage(clientId, userId);
    return res
      .json({ message: "Added to queue", status: "success" })
      .status(200);
  } catch (err) {
    return res.json({ message: err.message, status: "failed" }).status(500);
  }

  // await redisClient.lpop(clientId);

  // const result = await redisClient.lrange(clientId, 0, -1);

  // console.log({ result });
});

app.get("/chat-groups/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);

  try {
    const chats = await client.getChats();
    const response = [];
    for (const chat of chats) {
      const participants = await chat.participants;
      response.push({ participants, chat });
    }
    return res.json(response).status(200);
  } catch (err) {
    return res.json({ error: err.message, status: "failed" }).status(500);
  }
});

// Send message endpoint for a specific client
app.post("/message/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);

  if (!client) {
    return res.status(404);
  }

  const { number, message, media } = req.body;

  if (!number) {
    return res.status(500).send({
      status: "failed",
      message: "Please send number to send message",
    });
  }

  if (media) {
    try {
      const formattedMedia = await getMessageMedia(media);
      await client.sendMessage(number + "@c.us", formattedMedia, {
        caption: message,
      });
      res.status(200).send({ status: "success" });
    } catch (error) {
      console.error(error.message);
      res.status(500).send({ status: "failed" });
    }
  } else {
    try {
      // const chat = await client.getChatById(number + "@c.us");
      await client.sendMessage(number + "@c.us", message);
      res.status(200).send({ status: "success" });
    } catch (error) {
      console.error(error.message);
      res.status(500).send({ status: "failed" });
    }
  }
});

app.post("/excel-to-json", upload.single("contact_file"), async (req, res) => {
  const response = await excelToJson(req.file);

  return res.status(200).send({ data: response });
});

app.post("/json-to-excel", (req, res) => {
  const jsonData = req.body;

  // Create a new workbook
  const workbook = utils.book_new();

  // Convert the JSON data to a worksheet
  const worksheet = utils.json_to_sheet(jsonData);

  // Add the worksheet to the workbook
  utils.book_append_sheet(workbook, worksheet, "Sheet1");

  // Write the workbook to a buffer
  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

  // Set the content type and disposition headers
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=data.xlsx");

  // Send the buffer as the response
  res.end(Buffer.from(buffer, "base64"));
});

app.get("/fetch-contacts/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);
  try {
    const data = await client?.getContacts();
    return res.status(200).send({ data });
  } catch (err) {
    return res
      .status(500)
      .send({ message: "Something went wrong", status: "failed" });
  }
});

app.get("/destryo-client/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  try {
    await destroyClient(clientId);
    return res.status(200).send({
      status: "success",
      message:
        "ohh something is not right, we are resetting please try to connect now",
    });
  } catch (err) {
    return res
      .status(500)
      .send({ message: "Unable to reset client", status: "failed" });
  }
});

app.get("/client-info/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);

  try {
    const data = await client?.info;
    return res.status(200).send({ data });
  } catch (err) {
    return res
      .status(500)
      .send({ message: "Something went wrong", status: "failed" });
  }
});

// Create a new client
app.post("/client", async (req, res) => {
  const clientId = req.body.clientId;
  const botId = req.body.botId;
  const channelId = req.user.id;
  if (!clientId) {
    return res.status(400).send({ message: "Please send client id" });
  }

  if (clients.get(clientId)) {
    try {
      const clientStatus =
        (await clients.get(clientId)?.getState()) ?? "connecting";
      sendEvent({
        channel: channels[channelId],
        event: "whatsapp_event",
        payload: {
          clientId: clientId,
          type: "whatsapp_state",
          data: clientStatus,
        },
      });
      return res.status(400).send({
        message: `client is ${clientStatus}`,
        data: {
          payload: {
            clientId: clientId,
            type: "whatsapp_state",
            data: clientStatus,
          },
        },
      });
    } catch (err) {
      await destroyClient(clientId);
      return res.status(400).send({
        message: `Something is not right, don't worry we are resetting your client, please try again`,
        data: {
          payload: {
            clientId: clientId,
            type: "whatsapp_state",
            data: "disconnected",
          },
        },
      });
    }
  }

  channels[channelId] = await createChannel({ roomId: channelId });

  await startClient(clientId, channelId, channels, io, botId);

  try {
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: {
        clientId: clientId,
        type: "whatsapp_state",
        data: "connecting",
      },
    });
    res.status(200).send({
      message: "Hurray, We started connecting your client",
      data: {
        payload: {
          clientId: clientId,
          type: "whatsapp_state",
          data: "connecting",
        },
      },
    });
  } catch (err) {
    sendEvent({
      channel: channels[channelId],
      event: "whatsapp_event",
      payload: {
        clientId: clientId,
        type: "error",
        data: { message: err.message },
      },
    });
    res.status(500).send({
      message: "Something went wrong",
      payload: {
        type: "error",
        data: { message: err.message },
        clientId: clientId,
      },
    });
  }
});

// Handle process error events
process.on("uncaughtException", (error) => {
  console.error(`Uncaught exception: ${error}`);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error(`Unhandled rejection: ${error}`);
  // process.exit(1);
});

// Handle shutdown events
process.on("SIGINT", async () => {
  console.log("Received SIGINT signal, shutting down");
  for (const [id] of clients) {
    await destroyClient(id);
  }
  process.exit();
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM signal, shutting down");
  for (const [id] of clients) {
    await destroyClient(id);
  }
  process.exit();
});

const start = async () => {
  try {
    const [, PORT] = process.execArgv;
    await server.listen({ port: process.env.PORT || PORT });
    console.log(`Server started ${process.env.PORT || PORT}`);
  } catch (err) {
    process.exit(1);
  }
};

start();
