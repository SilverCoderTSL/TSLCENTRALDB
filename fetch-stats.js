const fs = require('fs');
const https = require('https');

const REGION_NAME = 'the_southern_lands';
const USER_AGENT = 'TSL Regional Stats Generator - Maintained by Silver Republics';

// Grade point mapping for Power Budget recalculation/verification
const GRADE_POINTS = {
    'S': 3, 'A': 2, 'B': 1, 'C': 0, 'D': -1, 'F': -2,
    'RETRO': -1, 'MODERN': 0, 'NEAR-FUTURE': 1, 'HIGH-TECH': 2,
    'DEMILITARIZED': -1, 'PEACEKEEPING': 0, 'ACTIVE PATROL': 1, 'FORTIFIED': 2
};

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

/**
 * Extracts key-value stats out of structured plain text/BBCode
 */
function parseCodeBlock(codeText) {
    const lines = codeText.split('\n');
    const stats = {};
    
    let currentSection = 'general';

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;

        // Detect section headers (e.g. === ECONOMIC PROFILE ===)
        if (trimmed.startsWith('===') && trimmed.endsWith('===')) {
            currentSection = trimmed.replace(/=/g, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
            return;
        }

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx !== -1) {
            const rawKey = trimmed.slice(0, colonIdx).trim();
            const rawVal = trimmed.slice(colonIdx + 1).trim();

            // Patch: Collapse consecutive non-alphanumeric characters into a single underscore
            const normalizedKey = rawKey
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
            
            if (normalizedKey && rawVal) {
                stats[normalizedKey] = rawVal;
            }
        }
    });

    return stats;
}

/**
 * Evaluates rules: Max 100M Population, Max 2 S-Tiers, Max 7 Power Points
 */
function auditPowerBudget(stats) {
    let powerPoints = 0;
    let sTierCount = 0;
    const auditLog = [];

    // Check Population Limit
    const popMatch = (stats.population || '').match(/([\d.]+)/);
    const popVal = popMatch ? parseFloat(popMatch[1]) : null;

    if (popVal !== null && popVal > 100) {
        auditLog.push(`Population (${popVal}M) exceeds 100M cap.`);
    }

    // Patch: Normalized keys matching HTML BBCode output
    const gradeFields = [
        'economy_grade', 
        'resource_wealth', 
        'tech_tier', 
        'infrastructure', 
        'defense_stance', 
        'culture_influence', 
        'education_r_d'
    ];

    gradeFields.forEach(field => {
        if (stats[field]) {
            const valUpper = stats[field].trim().toUpperCase();
            
            if (valUpper in GRADE_POINTS) {
                const pts = GRADE_POINTS[valUpper];
                powerPoints += pts;
                if (valUpper === 'S') sTierCount++;
            }
        }
    });

    if (sTierCount > 2) {
        auditLog.push(`S-Tier limit exceeded (${sTierCount}/2).`);
    }

    if (powerPoints > 7) {
        auditLog.push(`Power Budget exceeded (${powerPoints}/7 Points).`);
    }

    return {
        powerScore: powerPoints,
        sTierCount: sTierCount,
        isValid: auditLog.length === 0,
        violations: auditLog
    };
}

async function buildRegionStats() {
    console.log(`[1/3] Querying regional roster for: ${REGION_NAME}...`);
    
    try {
        const regionXml = await makeApiRequest(`/cgi-bin/api.cgi?region=${REGION_NAME}&q=nations`);
        const nationsMatch = regionXml.match(/<NATIONS>(.*?)<\/NATIONS>/s);
        
        if (!nationsMatch) {
            console.error("❌ Failed to parse nations list from API response.");
            return;
        }

        const nationsList = nationsMatch[1].split(':');
        console.log(`Found ${nationsList.length} nations in ${REGION_NAME}.\n`);

        const compiledStatsData = [];

        for (let i = 0; i < nationsList.length; i++) {
            const nation = nationsList[i];
            console.log(`--------------------------------------------------`);
            console.log(`[${i + 1}/${nationsList.length}] Checking nation: ${nation}`);

            await sleep(650); // API Rate Limiting Compliance

            const dispatchListXml = await makeApiRequest(`/cgi-bin/api.cgi?q=dispatchlist&nation=${nation}`);
            
            if (!dispatchListXml.includes('<DISPATCH')) {
                console.log(`  └─ ⚠️  No dispatches published by ${nation}.`);
                continue;
            }

            const dispatchBlocks = dispatchListXml.match(/<DISPATCH id="(\d+)">[\s\S]*?<\/DISPATCH>/g) || [];
            console.log(`  └─ Found ${dispatchBlocks.length} total dispatch(es) for ${nation}.`);

            let targetDispatchId = null;

            for (const block of dispatchBlocks) {
                const idMatch = block.match(/<DISPATCH id="(\d+)">/);
                const titleMatch = block.match(/<TITLE>(.*?)<\/TITLE>/i);

                if (idMatch && titleMatch) {
                    const id = idMatch[1];
                    const rawTitle = titleMatch[1].trim();
                    const cleanTitle = rawTitle.replace(/<!\[CDATA\[|\]\]>/g, '').trim().toUpperCase();

                    if (cleanTitle === 'STATS') {
                        targetDispatchId = id;
                        console.log(`     └── 🎯 MATCH FOUND! "STATS" Dispatch ID: ${targetDispatchId}`);
                        break;
                    }
                }
            }

            if (!targetDispatchId) {
                console.log(`  └─ ❌ No STATS dispatch found for ${nation}.`);
                continue;
            }

            await sleep(650);
            const dispatchXml = await makeApiRequest(`/cgi-bin/api.cgi?q=dispatch&dispatchid=${targetDispatchId}`);

            const cleanText = dispatchXml
                .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&amp;/g, '&');

            const codeMatch = cleanText.match(/\[code\]([\s\S]*?)\[\/code\]/);

            if (!codeMatch) {
                console.log(`  └─ ❌ Found STATS dispatch (#${targetDispatchId}), but missing [code]...[/code] block!`);
                continue;
            }

            try {
                const rawCodeBlock = codeMatch[1].trim();
                const parsedStats = parseCodeBlock(rawCodeBlock);
                const auditResults = auditPowerBudget(parsedStats);
                const canonicalId = nation.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');

                // Ensure the stats sub-object also reflects the canonical nation name for fallback matchers
                if (!parsedStats.nation) {
                    parsedStats.nation = nation;
                }

                const nationRecord = {
                    nation_id: canonicalId,
                    nation_canonical_name: nation,
                    dispatch_id: targetDispatchId,
                    last_updated: new Date().toISOString(),
                    stats: parsedStats,
                    audit: auditResults
                };

                compiledStatsData.push(nationRecord);

                if (auditResults.isValid) {
                    console.log(`  └─ ✅ SUCCESS! Parsed & Validated stats for ${nation} (Power: ${auditResults.powerScore}/7).`);
                } else {
                    console.log(`  └─ ⚠️  PARSED WITH WARNINGS (${nation}): ${auditResults.violations.join(' | ')}`);
                }

            } catch (e) {
                console.log(`  └─ ⚠️  SKIPPED ${nation}: Error parsing dispatch text syntax.`);
            }
        }

        console.log(`\n==================================================`);
        fs.writeFileSync('region-stats-data.json', JSON.stringify(compiledStatsData, null, 2));
        console.log(`🎉 FINISHED! Created 'region-stats-data.json' with ${compiledStatsData.length} nation entries.`);

    } catch (err) {
        console.error("Fatal Error building region stats:", err);
    }
}

buildRegionStats();
