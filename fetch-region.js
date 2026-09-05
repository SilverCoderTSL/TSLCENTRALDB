const fs = require('fs');
const https = require('https');
const TSL_Integrity = require('./utils/integrity.js');

const REGION_NAME = 'the_southern_lands';
const USER_AGENT = 'TSL Regional Map Generator - Maintained by Silver Republics';

function makeApiRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'www.nationstates.net',
            path: path,
            headers: { 'User-Agent': USER_AGENT }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', err => reject(err));
    });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRandomTacticalColor() {
    const colors = [
        '#00ff00', '#ff0055', '#00e5ff', '#ffaa00', 
        '#b500ff', '#ffea00', '#00ff99', '#ff3300'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

async function buildRegionMap() {
    console.log(`[1/3] Querying roster for region: ${REGION_NAME}...`);
    
    try {
        const regionXml = await makeApiRequest(`/cgi-bin/api.cgi?region=${REGION_NAME}&q=nations`);
        const nationsMatch = regionXml.match(/<NATIONS>(.*?)<\/NATIONS>/s);
        
        if (!nationsMatch) {
            console.error("❌ Failed to parse nations list from API response.");
            console.log("DEBUG Region XML:", regionXml.slice(0, 300));
            return;
        }

        const nationsList = nationsMatch[1].split(':');
        console.log(`Found ${nationsList.length} nations in ${REGION_NAME}.\n`);

        const compiledMapData = [];

        for (let i = 0; i < nationsList.length; i++) {
            const nation = nationsList[i];
            console.log(`--------------------------------------------------`);
            console.log(`[${i + 1}/${nationsList.length}] Checking nation: ${nation}`);

            await sleep(650);

            // Fetch nation's dispatch list
            const dispatchListXml = await makeApiRequest(`/cgi-bin/api.cgi?q=dispatchlist&nation=${nation}`);
            
            // Debug check: did the nation return dispatches?
            if (!dispatchListXml.includes('<DISPATCH')) {
                console.log(`  └─ ⚠️  No dispatches published by ${nation}.`);
                continue;
            }

            // Robust regex to extract each dispatch ID and its TITLE
            const dispatchBlocks = dispatchListXml.match(/<DISPATCH id="(\d+)">[\s\S]*?<\/DISPATCH>/g) || [];
            console.log(`  └─ Found ${dispatchBlocks.length} total dispatch(es) for ${nation}.`);

            let targetDispatchId = null;

            for (const block of dispatchBlocks) {
                const idMatch = block.match(/<DISPATCH id="(\d+)">/);
                const titleMatch = block.match(/<TITLE>(.*?)<\/TITLE>/i);

                if (idMatch && titleMatch) {
                    const id = idMatch[1];
                    const rawTitle = titleMatch[1].trim();
                    console.log(`     ├── Dispatch ID ${id}: "${rawTitle}"`);

                    // Check if title matches "MAP" or contains "MAP"
                    // NEW: Requires exact title "MAP" or "REGIONAL MAP"
                    const cleanTitle = rawTitle.replace(/<!\[CDATA\[|\]\]>/g, '').trim().toUpperCase();

                    if (cleanTitle === 'MAP' || cleanTitle === 'REGIONAL MAP') {
                        targetDispatchId = id;
                        console.log(`     └── 🎯 MATCH FOUND! Target Dispatch ID: ${targetDispatchId}`);
                        break;
                    }
                }
            }

            if (!targetDispatchId) {
                console.log(`  └─ ❌ No dispatch with title 'MAP' found for ${nation}.`);
                continue;
            }

            // Fetch the specific dispatch content
            await sleep(650);
            const dispatchXml = await makeApiRequest(`/cgi-bin/api.cgi?q=dispatch&dispatchid=${targetDispatchId}`);

            const cleanText = dispatchXml
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&amp;/g, '&');

            const codeMatch = cleanText.match(/\[code\]([\s\S]*?)\[\/code\]/);

            if (!codeMatch) {
                console.log(`  └─ ❌ Found MAP dispatch (#${targetDispatchId}), but missing [code]...[/code] tags!`);
                console.log(`  DEBUG Dispatch Content Preview:\n${cleanText.slice(0, 300)}...`);
                continue;
            }

            // NEW BULLETPROOF PARSER:
            // Dynamic Parser inside fetch-region_2.js:
            try {
                const codeBlock = codeMatch[1].trim();
                const lines = codeBlock.split('\n');
                
                const meta = {};
                let rawData = "";

                // Parse key-value pairs line by line
                lines.forEach(line => {
                    const colonIdx = line.indexOf(':');
                    if (colonIdx !== -1) {
                        const key = line.slice(0, colonIdx).trim().toLowerCase();
                        const val = line.slice(colonIdx + 1).trim();

                        if (key === 'data') {
                            rawData = val;
                        } else {
                            meta[key] = val;
                        }
                    }
                });

                // Fallback if data was on its own line or fallback structure
                if (!rawData) {
                    const dataMatch = codeBlock.match(/Data:\s*([A-Za-z0-9+/=]+)/i);
                    rawData = dataMatch ? dataMatch[1].trim() : codeBlock.trim();
                }

                // Verify spatial coordinates
                const verification = TSL_Integrity.verifyAndParse(rawData, 2271, 1133);

                if (verification.valid) {
                    const nationData = verification.data;

                    // Always derive nation_id deterministically from the canonical NationStates API loop variable
                    const canonicalId = nation.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');

                    nationData.nation_id = canonicalId;
                    nationData.nation = meta['nation'] || nation;
                    
                    if (!nationData.capital) nationData.capital = {};
                    nationData.capital.name = meta['capital'] || "Capital City";

                    // Expandable stats mapped dynamically
                    nationData.government = meta['government'] || "Unknown";
                    nationData.population = meta['population'] || "Unknown";

                    // Dynamically attach extra stats
                    for (const [k, v] of Object.entries(meta)) {
                        if (!['nation', 'capital', 'government', 'population', 'data', 'nation_id'].includes(k)) {
                            nationData[k] = v;
                        }
                    }

                    nationData.color = nationData.color || getRandomTacticalColor();
                    compiledMapData.push(nationData);
                    console.log(`  └─ ✅ SUCCESS! Parsed & Verified map data for ${nation}.`);
                } else {
                    console.log(`  └─ ⚠️  REJECTED ${nation}: ${verification.error}`);
                }
            } catch (e) {
                console.log(`  └─ ⚠️  SKIPPED ${nation}: Invalid dispatch code formatting.`);
            }
        }

        console.log(`\n==================================================`);
        fs.writeFileSync('region-map-data.json', JSON.stringify(compiledMapData, null, 2));
        console.log(`🎉 FINISHED! Created 'region-map-data.json' with ${compiledMapData.length} valid nation map entry/entries.`);

    } catch (err) {
        console.error("Fatal Error building region map:", err);
    }
}

buildRegionMap();
