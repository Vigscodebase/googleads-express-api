import axios from "axios";

export const getAds = async (req, res) => {
    try {

        const userId = req.query.userId;
        const customerId = req.query.customerId;
        const activeDateRange = req.query.activeDateRange;
        const user = users[userId];

        if (!user) {
            return res.status(404).send("User not found");
        }

        const response = await axios.post(
            `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:search`,
            {
                query: `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions_value FROM campaign WHERE segments.date DURING ${activeDateRange}`
                // query: "SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions, metrics.conversions_value FROM campaign"
            },
            {
                headers: {
                    Authorization: `Bearer ${user.access_token}`,
                    "developer-token": DEVELOPER_TOKEN,
                    "login-customer-id": userId
                }
            }
        );

        res.json(response.data);

    } catch (error) {
        console.error("Error checking token:", error.response?.data || error.message);
        res.status(500).json({
            error: error.response?.data || error.message,
        })
    }
}

// export const getAds = async (req, res) => {
//     try {
//         const { userId, customerId, dateRange, startDate, endDate } = req.query;

//         const user = users[userId];
//         if (!user) {
//             return res.status(404).send("User not found");
//         }

//         // ✅ Build dynamic date filter
//         let dateFilter = '';

//         if (dateRange === 'custom' && startDate && endDate) {
//             dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
//         } else {
//             dateFilter = `segments.date DURING ${dateRange || 'LAST_30_DAYS'}`;
//         }

//         // ✅ FULL QUERY (2025/2026 READY)
//         const query = `
//         SELECT
//           campaign.id,
//           campaign.name,
//           campaign.status,
//           metrics.cost_micros,
//           metrics.impressions,
//           metrics.clicks,
//           metrics.ctr,
//           metrics.conversions,
//           metrics.conversions_value
//         FROM campaign
//         WHERE ${dateFilter}
//         `;

//         const response = await axios.post(
//             `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`,
//             { query },
//             {
//                 headers: {
//                     Authorization: `Bearer ${user.access_token}`,
//                     "developer-token": DEVELOPER_TOKEN,
//                     "login-customer-id": user.managerId || undefined // optional MCC
//                 }
//             }
//         );

//         // ✅ Normalize response (IMPORTANT)
//         const results = (response.data.results || []).map(r => ({
//             campaign: r.campaign,
//             metrics: {
//                 costMicros: Number(r.metrics?.costMicros || 0),
//                 impressions: Number(r.metrics?.impressions || 0),
//                 clicks: Number(r.metrics?.clicks || 0),
//                 ctr: Number(r.metrics?.ctr || 0),
//                 conversions: Number(r.metrics?.conversions || 0),
//                 conversionsValue: Number(r.metrics?.conversionsValue || 0)
//             }
//         }));

//         console.log("RAW GOOGLE RESPONSE ↓↓↓");
//         console.log(JSON.stringify(response.data, null, 2));

//         res.json({ results });

//     } catch (error) {
//         console.error("Google Ads Error:", error.response?.data || error.message);

//         res.status(500).json({
//             error: error.response?.data || error.message,
//         });
//     }
// };