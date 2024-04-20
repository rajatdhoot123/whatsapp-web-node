const { authenticateSocket } = require("./middlewares");

module.exports = function (io) {
  io.use(authenticateSocket);
  io.on("connection", (socket) => {
    const user = socket.user;

    socket.on("join", (userId) => {
      console.log(`User ${userId} joined`);

      // Create a room based on the user ID
      socket.join(userId);

      // Emit welcome message to the user
      io.to(userId).emit("joined_room", `Welcome to room ${userId}`);
    });
  });

  // Handle reconnections and other edge cases
  io.on("connection_error", (error) => {
    console.log("Connection error:", error);
  });

  io.on("connect_timeout", (timeout) => {
    console.log("Connection timeout:", timeout);
  });

  io.on("reconnect", (attemptNumber) => {
    console.log(`Reconnected after ${attemptNumber} attempts`);
  });

  io.on("reconnect_attempt", (attemptNumber) => {
    console.log(`Attempting to reconnect (${attemptNumber})...`);
  });

  io.on("reconnect_error", (error) => {
    console.log("Reconnection error:", error);
  });

  io.on("reconnect_failed", () => {
    console.log("Reconnection failed");
  });
};
