const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const updateCampaignStatus = async ({ status, campaign_id, messages }) => {
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: status, messages })
    .eq("id", campaign_id);

  return { data, error };
};

const createChannel = async ({ roomId }) => {
  const channel = await supabase.channel(roomId).subscribe();
  return channel;
};

const sendEvent = ({ channel, event, payload }) => {
  channel.send({ payload, event, type: "broadcast" });
};

const verifyUser = async (token) => {
  const { user, error } = await supabase.auth.api.getUser(token);
  return { user, error };
};

module.exports = {
  verifyUser,
  supabase,
  createChannel,
  sendEvent,
  updateCampaignStatus,
};
