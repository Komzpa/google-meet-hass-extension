const loadConfig = jest.fn().mockResolvedValue({});
const setEntityState = jest.fn().mockResolvedValue(undefined);

jest.mock("./config", () => ({ loadConfig }));
jest.mock("./hass", () => ({ setEntityState }));

const heartbeatAlarmName = "meeting-state-heartbeat";
const queryTabs = jest.fn();
const getAlarm = jest.fn();
const createAlarm = jest.fn();
const addAlarmListener = jest.fn();

function loadBackground(existingAlarm?: chrome.alarms.Alarm) {
    jest.resetModules();
    queryTabs.mockReset();
    getAlarm.mockReset();
    createAlarm.mockReset();
    addAlarmListener.mockReset();
    setEntityState.mockReset();
    setEntityState.mockResolvedValue(undefined);
    getAlarm.mockImplementation(
        (_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) =>
            callback(existingAlarm)
    );

    (global as any).chrome = {
        alarms: {
            get: getAlarm,
            create: createAlarm,
            onAlarm: { addListener: addAlarmListener },
        },
        action: {
            setBadgeText: jest.fn(),
            setBadgeBackgroundColor: jest.fn(),
        },
        runtime: {
            onInstalled: { addListener: jest.fn() },
            onStartup: { addListener: jest.fn() },
        },
        tabs: {
            query: queryTabs,
            onRemoved: { addListener: jest.fn() },
            onUpdated: { addListener: jest.fn() },
        },
    };

    return require("./background") as typeof import("./background");
}

describe("meeting state reconciliation", () => {
    it("sends off after the last Meet tab is removed", async () => {
        const { requestMeetingStateReconciliation } = loadBackground();
        queryTabs.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);

        await requestMeetingStateReconciliation();
        await requestMeetingStateReconciliation();

        expect(setEntityState.mock.calls.map(([_, value]) => value)).toEqual([
            true,
            false,
        ]);
    });

    it("retries a transition after the HA update fails", async () => {
        const { requestMeetingStateReconciliation } = loadBackground();
        queryTabs.mockResolvedValue([{ id: 1 }]);
        setEntityState.mockRejectedValueOnce(new Error("HA unavailable"));

        await expect(requestMeetingStateReconciliation()).rejects.toThrow(
            "HA unavailable"
        );
        await requestMeetingStateReconciliation();

        expect(setEntityState).toHaveBeenCalledTimes(2);
        expect(setEntityState).toHaveBeenLastCalledWith({}, true);
    });

    it("retries a failed final off on the next heartbeat alarm", async () => {
        const { requestMeetingStateReconciliation } = loadBackground();
        const alarmListener = addAlarmListener.mock.calls[0][0];
        queryTabs
            .mockResolvedValueOnce([{ id: 1 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        await requestMeetingStateReconciliation();
        setEntityState.mockRejectedValueOnce(
            new Error("Home Assistant API request failed: HTTP 503")
        );
        await expect(requestMeetingStateReconciliation()).rejects.toThrow(
            "HTTP 503"
        );

        alarmListener({ name: heartbeatAlarmName });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(setEntityState.mock.calls.map(([_, value]) => value)).toEqual([
            true,
            false,
            false,
        ]);
    });

    it("renews the Home Assistant lease while a meeting remains open", async () => {
        const { requestMeetingStateReconciliation } = loadBackground();
        queryTabs.mockResolvedValue([{ id: 1 }]);

        await requestMeetingStateReconciliation(true);

        expect(setEntityState).toHaveBeenCalledTimes(1);
        expect(setEntityState).toHaveBeenCalledWith({}, true);
    });

    it("coalesces concurrent events while one update is in flight", async () => {
        const { requestMeetingStateReconciliation } = loadBackground();
        queryTabs.mockResolvedValue([]);
        let releaseUpdate: () => void = () => undefined;
        setEntityState.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseUpdate = resolve;
                })
        );

        const first = requestMeetingStateReconciliation();
        const second = requestMeetingStateReconciliation();
        await new Promise((resolve) => setTimeout(resolve, 0));
        releaseUpdate();
        await Promise.all([first, second]);

        expect(setEntityState).toHaveBeenCalledTimes(1);
        expect(queryTabs).toHaveBeenCalledTimes(2);
    });
});

describe("heartbeat alarm", () => {
    it("recovers a missing alarm when the service worker activates", () => {
        loadBackground();

        expect(getAlarm).toHaveBeenCalledWith(
            heartbeatAlarmName,
            expect.any(Function)
        );
        expect(createAlarm).toHaveBeenCalledWith(heartbeatAlarmName, {
            periodInMinutes: 1,
        });
    });

    it("does not reset an existing alarm when the service worker activates", () => {
        loadBackground({
            name: heartbeatAlarmName,
            scheduledTime: Date.now() + 30_000,
            periodInMinutes: 1,
        });

        expect(getAlarm).toHaveBeenCalledWith(
            heartbeatAlarmName,
            expect.any(Function)
        );
        expect(createAlarm).not.toHaveBeenCalled();
    });
});
