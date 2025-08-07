"use strict";
// Sample TypeScript file to test data flow analysis
let globalCounter = 0;
let userState = { name: "", isActive: false };
const CONFIG = { maxRetries: 3, timeout: 5000 };
function initializeApp() {
    globalCounter = 1;
    userState.name = "Default User";
    userState.isActive = true;
    console.log("App initialized with global state");
}
async function processUserData(userId) {
    if (!userState.isActive) {
        console.log("User state not active");
        return null;
    }
    const result = await fetchData(userId);
    globalCounter++;
    return result;
}
function fetchData(userId) {
    console.log(`Fetching data for ${userId}, retry count: ${globalCounter}`);
    if (globalCounter > CONFIG.maxRetries) {
        throw new Error("Max retries exceeded");
    }
    return Promise.resolve({ id: userId, data: "sample" });
}
function resetSystem() {
    globalCounter = 0;
    userState = { name: "", isActive: false };
    console.log("System reset");
}
function getCurrentState() {
    return {
        counter: globalCounter,
        user: userState,
        config: CONFIG
    };
}
//# sourceMappingURL=test-dataflow.js.map