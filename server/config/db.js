const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB Connected");
    } catch (error) {
        console.error("MongoDB connection error:", error.message);
        process.exit(1);
    }
};

mongoose.connection.on("error", (error) => {
    console.error("MongoDB runtime error:", error.message);
});

mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
    console.log("MongoDB reconnected");
});

module.exports = connectDB;