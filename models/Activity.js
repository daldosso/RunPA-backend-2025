const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema({}, { strict: false });

module.exports = mongoose.model("Activity", activitySchema);
