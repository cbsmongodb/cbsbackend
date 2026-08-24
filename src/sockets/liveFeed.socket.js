// Wires up socket.io connection logging. Actual "attendance:new" events
// are emitted from attendance.controller.js (it has direct access to the
// io instance passed in when the routes are mounted), so this file mainly
// exists as the place to add auth-on-connect, rooms, etc. later.

export function initLiveFeedSocket(io) {
  io.on("connection", (socket) => {
    console.log("Live feed client connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("Live feed client disconnected:", socket.id);
    });
  });
}
