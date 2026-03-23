import axios from "axios";

export const getAds = async (req, res) => {
    try {

        const userId = req.query.userId;
        const user = users[userId];

        if (!user) {
            return res.status(404).send("User not found");
        }

        const response = await axios.post(
            "https://googleads.googleapis.com/v16/customers/YOUR_CUSTOMER_ID/googleAds:search",
            {
                query: "SELECT campaign.id, campaign.name FROM campaign"
            },
            {
                headers: {
                    Authorization: `Bearer ${user.access_token}`,
                    "developer-token": DEVELOPER_TOKEN
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