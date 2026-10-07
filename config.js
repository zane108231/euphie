require("dotenv").config();

module.exports = {
    nodes: [
        {
            host: "lavalinkv4.serenetia.com",
            password: "https://seretia.link/discord",
            port: 80,
            secure: false,
            name: "Main",
        },
    ],

    prefix: "!",

    defaultSearchPlatform: "ytmsearch",
    restVersion: "v4",

    accentColor: 0x2b2d31,
    statusWebhookUrl: process.env.STATUS_WEBHOOK_URL,

    musicard: {
        theme: "Bloom",
        progressBarColor: "#FACC15",
        backgroundColor: "#2b2d31",
    },
};
