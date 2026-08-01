const express = require('express');
const axios = require('axios');
const cors = require('cors'); 
const fs = require('fs');       // Added: File System module to read/write files
const path = require('path');   // Added: Utility for handling system file paths
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json()); // Added: Allows Express to parse JSON payloads from POST requests
app.use(express.static(__dirname));

// Define a stable file path for your database text file
const DATA_FILE_PATH = path.join(__dirname, 'map_matrix.json');

// --- NEW ENDPOINT: Fetch Shared Map Data ---
app.get('/api/map-data', (req, res) => {
    // If the file doesn't exist yet, return an empty object
    if (!fs.existsSync(DATA_FILE_PATH)) {
        return res.json({});
    }
    
    fs.readFile(DATA_FILE_PATH, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send(`Failed to read persistent map matrix: ${err.message}`);
        }
        try {
            res.json(JSON.parse(data));
        } catch (parseErr) {
            res.status(500).send(`Data file corruption detected: ${parseErr.message}`);
        }
    });
});

// --- NEW ENDPOINT: Persist Map Data Globally ---
app.post('/api/map-data', (req, res) => {
    const updatedMatrix = req.body;
    
    fs.writeFile(DATA_FILE_PATH, JSON.stringify(updatedMatrix, null, 4), 'utf8', (err) => {
        if (err) {
            return res.status(500).send(`Write failure to persistent store: ${err.message}`);
        }
        console.log('[SYS-UPDATE] Global map matrix updated successfully on disk.');
        res.send('Storage alignment successful.');
    });
});

// Your existing NationStates Telemetry API proxy remains completely untouched
app.get('/api/telemetry', async (req, res) => {
    const nationName = req.query.name;
    if (!nationName) return res.status(400).send('Name designator missing.');

    const formattedName = nationName.toLowerCase().replace(/ /g, '_');
    const url = `https://www.nationstates.net/cgi-bin/api.cgi?nation=${formattedName}&q=name+population+gdp+currency+region+category+motto+animal+religion+freedom`;

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'TSL Central DB - System Admin Core' }
        });
        res.set('Content-Type', 'text/xml');
        res.send(response.data);
    } catch (error) {
        res.status(500).send(`Upstream connection failed: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`[SYS-ONLINE] Telemetry proxy and persistent storage active on port ${PORT}`);
});
