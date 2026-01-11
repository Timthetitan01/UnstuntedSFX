const functions = require("firebase-functions");
const admin = require("firebase-admin");

// 1. Initialize CORS middleware to allow requests from any origin
const cors = require('cors')({origin: true});

// 2. ⚠️ PASTE YOUR REAL STRIPE SECRET KEY HERE (sk_test_...)
const stripe = require("stripe")("sk_test_51RIcdZQ5PrTUuyRr3INl6IAgsaTCNx7lx4xu8rJtDRCtrMuUF3l4ulRy3UWZDAZmINhwrAyupxWdNF4ChAu48pkX00vJr3lmrj"); 

admin.initializeApp();

// --- FUNCTION 1: Create Secure Checkout Session ---
exports.createStripeCheckout = functions.https.onRequest((req, res) => {
    // 3. Wrap the entire function in the CORS handler
    cors(req, res, async () => {
        
        // A. Logging
        console.log("createStripeCheckout called.");
        console.log("Data:", req.body.data); // 'data' is inside body for https.onRequest

        // B. Manually check Auth Token (Since we switched to onRequest for CORS)
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (!idToken) {
            return res.status(401).send({data: {error: 'User must be logged in'}});
        }

        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const userId = decodedToken.uid;
            const { priceId, tierName, domainUrl } = req.body.data;

            // C. URL Handling
            const finalUrl = domainUrl || "https://timthetitan01.github.io/UnstuntedSFX";
            const cleanUrl = finalUrl.replace(/\/$/, ""); 

            // D. Create Session
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                mode: "subscription",
                line_items: [{
                    price: priceId,
                    quantity: 1,
                }],
                success_url: `${cleanUrl}/?success=true`,
                cancel_url: `${cleanUrl}/`,
                metadata: {
                    firebaseUID: userId,
                    tier: tierName
                }
            });

            // E. Success Response
            console.log("Session created:", session.id);
            res.status(200).send({data: { url: session.url }});

        } catch (error) {
            console.error("Error:", error);
            res.status(500).send({data: {error: error.message}});
        }
    });
});

// --- FUNCTION 2: Stripe Webhook (Keep as is) ---
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    // 4. ⚠️ PASTE YOUR REAL WEBHOOK SECRET HERE (whsec_...)
    const endpointSecret = "whsec_YQuloO9p9oHkWVyE3bJezgNGhdwxjskl"; 

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, signature, endpointSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const uid = session.metadata.firebaseUID;
        const tier = session.metadata.tier;

        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const expirationDate = Date.now() + thirtyDays;

        await admin.firestore().collection("users").doc(uid).set({
            isPremium: true,
            tier: tier,
            subscriptionEnd: expirationDate,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    res.json({ received: true });
});