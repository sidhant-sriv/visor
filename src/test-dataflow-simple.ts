// Simple test file for data flow analysis
let globalCounter = 0;
let userState = { name: "", isActive: false };
const CONFIG = { maxRetries: 3, timeout: 5000 };

function processUserData(userId: string) {
  if (!userState.isActive) return null;  // reads userState
  globalCounter++;                       // modifies globalCounter
  return `Processed: ${userId}`;
}

function resetUserState() {
  userState.name = "";     // writes userState
  userState.isActive = false; // writes userState
  globalCounter = 0;       // writes globalCounter
}

function getUserInfo(): string {
  return `User: ${userState.name}, Active: ${userState.isActive}, Count: ${globalCounter}`;
}

function initializeApp() {
  userState.name = "Default User";
  userState.isActive = true;
  console.log("App initialized");
}

async function asyncProcessor(data: string) {
  if (globalCounter > CONFIG.maxRetries) {
    throw new Error("Max retries exceeded");
  }
  globalCounter++;
  return processUserData(data);
}