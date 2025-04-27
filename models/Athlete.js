const mongoose = require("mongoose");

const AthleteSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    username: String,
    firstname: String,
    lastname: String,
    city: String,
    country: String,
    sex: String,
    profile: String,
    email: String,
    last_lat: Number,
    last_lng: Number,
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Athlete || mongoose.model("Athlete", AthleteSchema);
