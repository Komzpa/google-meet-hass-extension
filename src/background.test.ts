jest.mock("./config", () => ({
    loadConfig: jest.fn().mockResolvedValue({}),
}));
jest.mock("./hass", () => ({
    setEntityState: jest.fn().mockResolvedValue(undefined),
}));

const queryTabs = jest.fn();
const setEntityState = require("./hass").setEntityState as jest.Mock;

(global as any).chrome = {
    alarms: {
        create: jest.fn(),
        onAlarm: { addListener: jest.fn() },
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

import { requestMeetingStateReconciliation } from "./background";

describe("meeting state reconciliation", () => {
    beforeEach(() => {
        queryTabs.mockReset();
        setEntityState.mockReset();
        setEntityState.mockResolvedValue(undefined);
    });

    it("sends off after the last Meet tab is removed", async () => {
        queryTabs.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);

        await requestMeetingStateReconciliation();
        await requestMeetingStateReconciliation();

        expect(setEntityState.mock.calls.map(([_, value]) => value)).toEqual([
            true,
            false,
        ]);
    });

    it("retries a transition after the HA update fails", async () => {
        queryTabs.mockResolvedValue([{ id: 1 }]);
        setEntityState.mockRejectedValueOnce(new Error("HA unavailable"));

        await expect(requestMeetingStateReconciliation()).rejects.toThrow(
            "HA unavailable"
        );
        await requestMeetingStateReconciliation();

        expect(setEntityState).toHaveBeenCalledTimes(2);
        expect(setEntityState).toHaveBeenLastCalledWith({}, true);
    });

    it("renews the Home Assistant lease while a meeting remains open", async () => {
        queryTabs.mockResolvedValue([{ id: 1 }]);

        await requestMeetingStateReconciliation(true);

        expect(setEntityState).toHaveBeenCalledTimes(1);
        expect(setEntityState).toHaveBeenCalledWith({}, true);
    });

    it("coalesces concurrent events while one update is in flight", async () => {
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
