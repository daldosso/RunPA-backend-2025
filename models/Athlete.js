const mongoose = require("mongoose");

const athleteSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  username: String,
  firstname: String,
  lastname: String,
  city: String,
  country: String,
  sex: String,
  profile: String,
  email: String,
}, { timestamps: true });

module.exports = mongoose.model("Athlete", athleteSchema);
