const mongoose = require("mongoose");

const AthleteSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  username: String,
  firstname: String,
  lastname: String,
  city: String,
  state: String,
  country: String,
  sex: String,
  profile: String,
});

module.exports =
  mongoose.models.Athlete || mongoose.model("Athlete", AthleteSchema);
