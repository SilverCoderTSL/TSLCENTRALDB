const { schedule } = require('@netlify/functions');
const execSync = require('child_process').execSync;

// Runs every 6 hours automatically
const handler = async (event, context) => {
    console.log("Starting NationStates region data sync...");
    try {
        // Runs your existing node script
        execSync('node fetch-region.js');
        return { statusCode: 200, body: JSON.stringify({ message: "Sync successful!" }) };
    } catch (error) {
        console.error("Sync failed:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// Cron expression: runs at minute 0 every 6 hours
exports.handler = schedule('0 */6 * * *', handler);
