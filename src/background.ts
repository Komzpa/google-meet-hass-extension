import { loadConfig } from "./config";
import { setEntityState } from "./hass";

let wasInMeeting: boolean | null = null;
let reconciliationPromise: Promise<void> | null = null;
let reconciliationRequested = false;
let heartbeatRequested = false;

const heartbeatAlarmName = "meeting-state-heartbeat";

function updateBadge(isInMeeting: boolean) {
    chrome.action.setBadgeText({ text: isInMeeting ? "mtg" : "" });
    chrome.action.setBadgeBackgroundColor({
        color: isInMeeting ? "red" : "green",
    });
}

async function reconcileMeetingState(forceSend: boolean) {
    const tabs = await chrome.tabs.query({
        url: "https://meet.google.com/*-*-*",
    });
    const isInMeeting = tabs.length > 0;

    updateBadge(isInMeeting);

    // Heartbeats renew the HA lease while a meeting is open. Normal
    // reconciliations only send when the observed state differs.
    if (wasInMeeting === isInMeeting && !(forceSend && isInMeeting)) {
        return;
    }

    const config = await loadConfig();
    await setEntityState(config, isInMeeting);

    // Keep the old value until HA accepted the update, so a later event can
    // retry a failed final off (or any other failed transition).
    wasInMeeting = isInMeeting;
}

export function requestMeetingStateReconciliation(forceSend = false) {
    reconciliationRequested = true;
    heartbeatRequested = heartbeatRequested || forceSend;

    if (reconciliationPromise === null) {
        const drain = (async () => {
            while (reconciliationRequested) {
                reconciliationRequested = false;
                const sendHeartbeat = heartbeatRequested;
                heartbeatRequested = false;
                await reconcileMeetingState(sendHeartbeat);
            }
        })();
        reconciliationPromise = drain;

        const finishDrain = () => {
            if (reconciliationPromise !== drain) {
                return;
            }
            reconciliationPromise = null;
            if (reconciliationRequested) {
                handleReconciliationRequest();
            }
        };
        drain.then(finishDrain, finishDrain);
    }

    return reconciliationPromise;
}

function handleReconciliationRequest(forceSend = false) {
    requestMeetingStateReconciliation(forceSend).catch((error) => {
        console.error("Failed to reconcile Google Meet state", error);
    });
}

function ensureHeartbeat() {
    chrome.alarms.get(heartbeatAlarmName, (alarm) => {
        if (!alarm) {
            chrome.alarms.create(heartbeatAlarmName, { periodInMinutes: 1 });
        }
    });
}

ensureHeartbeat();

chrome.runtime.onInstalled.addListener(() => {
    handleReconciliationRequest();
});
chrome.runtime.onStartup.addListener(() => {
    handleReconciliationRequest();
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === heartbeatAlarmName) {
        handleReconciliationRequest(true);
    }
});
chrome.tabs.onRemoved.addListener(() => handleReconciliationRequest());
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status === "complete") {
        handleReconciliationRequest();
    }
});
