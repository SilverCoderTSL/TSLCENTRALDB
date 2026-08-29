const { schedule } = require('@netlify/functions');
const execSync = require('child_process').execSync;

const handler = async (event, context) => {
    console.log("Starting NationStates region data sync...");
    try {
        // Runs your existing node script
        execSync('node fetch-region.js');
        console.log("Sync successful!");
    } catch (error) {
        console.error("Sync failed:", error);
    }
};

// Cron expression: runs at minute 0 every 6 hours
exports.handler = schedule('0 */6 * * *', handler);
