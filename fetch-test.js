const fs = require('fs');
const https = require('https');

const DISPATCH_ID = '2803410'; 

const options = {
    hostname: 'www.nationstates.net',
    path: `/cgi-bin/api.cgi?q=dispatch&dispatchid=${DISPATCH_ID}`,
    headers: {
        'User-Agent': 'Regional Map Generator - Silver Republics'
    }
};

console.log("Connecting to NationStates API...");

https.get(options, (res) => {
    let rawData = '';

    res.on('data', (chunk) => {
        rawData += chunk;
    });

    res.on('end', () => {
        // Decode common XML entities returned by NS API
        let cleanText = rawData
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&');

        // Extract content inside [code]...[/code]
        const match = cleanText.match(/\[code\]([\s\S]*?)\[\/code\]/);

        if (!match) {
            console.error("Could not find [code] block in dispatch text!");
            console.log("DEBUG API Response preview:\n", cleanText.slice(0, 400));
            return;
        }

        try {
            const nationData = JSON.parse(match[1].trim());
            
            // Write output JSON
            fs.writeFileSync('single-nation-data.json', JSON.stringify([nationData], null, 2));
            console.log("SUCCESS! Created 'single-nation-data.json' from NS API.");
        } catch (err) {
            console.error("Failed to parse JSON inside [code] tags:", err.message);
            console.log("Extracted snippet was:", match[1]);
        }
    });

}).on('error', (e) => {
    console.error(`HTTPS Request Error: ${e.message}`);
});
