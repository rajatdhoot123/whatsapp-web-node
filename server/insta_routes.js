const express = require("express");
const { IgApiClient } = require("instagram-private-api");
const router = express.Router();
const { LocalStorage } = require("node-localstorage");

const store = new LocalStorage("./insta_storage");

const instagramHelper = {
  resetInstagram: () => {
    store.setItem("instagram_session", {});
  },
  saveSession: (username, data) => {
    store.setItem(username, JSON.stringify(data));
    return data;
  },
  deleteSession: (username) => {
    store.removeItem(username);
  },
  isSessionExist: (username) => {
    const instaSession = store.getItem(username);
    if (instaSession) {
      return true;
    }
    return false;
  },

  sessionLoad: (username) => {
    const instaSession = store.getItem(username);
    if (instaSession) {
      return JSON.parse(instaSession);
    }
    return undefined;
  },
};

const instaUserClients = new Map();

router.post("/message/:insta_client", async (req, res) => {
  const instaClient = req.params.insta_client;
  const instagramClient = instaUserClients.get(instaClient);

  if (!instagramClient) {
    return res.json({ status: "failed" });
  }

  const { insta_handle, message } = req.body;

  try {
    const userId = await instagramClient.user.getIdByUsername(insta_handle);
    const thread = instagramClient.entity.directThread([userId.toString()]);
    await thread.broadcastText(message);
    return res.json({ status: "success" });
  } catch (err) {
    console.log({ err });
    return res.json({
      error: err.message,
      status: "failed",
    });
  }
});

router.post("/login", async (req, res) => {
  const instagramClient = new IgApiClient();
  const { username, password } = req.body;
  instaUserClients.set(username, instagramClient);

  instagramClient.state.generateDevice(username);
  instagramClient.request.end$.subscribe(async () => {
    const serialized = await instagramClient.state.serialize();
    delete serialized.constants;
    instagramHelper.saveSession(username, serialized);
  });
  if (instagramHelper.isSessionExist(username)) {
    try {
      await instagramClient.state.deserialize(
        instagramHelper.sessionLoad(username)
      );
      let pk = await instagramClient.user.getIdByUsername(username);
      return res.json({ status: "success", data: pk });
    } catch (err) {
      return res.json({ status: "failed", message: err.message });
    }
  } else {
    try {
      await instagramClient.simulate.preLoginFlow();
      const loginUser = await instagramClient.account.login(username, password);
      return res.json({ user: loginUser });
    } catch (err) {
      instagramHelper.deleteSession(username);
      instaUserClients.delete(username);
      return res.json({ status: "failed", message: "Something went wrong" });
    } finally {
      process.nextTick(async () => {
        try {
          await instagramClient.simulate.postLoginFlow();
        } catch (err) {
          console.log(err);
        }
      });
    }
  }
});

module.exports = router;
