const mongoose = require("mongoose");

const ActivitySchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: String,
  distance: Number,
  moving_time: Number,
  elapsed_time: Number,
  total_elevation_gain: Number,
  type: String,
  start_date: String,
  start_latlng: [Number],
  athlete: {
    id: Number,
    firstname: String,
    lastname: String,
  },
  location: {
    city: { type: String, default: null },
    state: { type: String, default: null },
    country: { type: String, default: null },
  },
});

module.exports = mongoose.model("Activity", ActivitySchema);
