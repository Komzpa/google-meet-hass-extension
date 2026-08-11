import { Config } from "./config";
import { setEntityState } from "./hass";

const apiConfig: Config = {
    host: "https://ha.example.test",
    token: "token",
    entity_id: "input_boolean.in_meeting",
    method: "api",
    webhook_url: "",
};

describe("setEntityState", () => {
    beforeEach(() => {
        global.fetch = jest
            .fn()
            .mockResolvedValue({ status: 200 }) as jest.Mock;
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it("turns entities on through Home Assistant services", async () => {
        await setEntityState(apiConfig, true);

        expect(global.fetch).toHaveBeenCalledWith(
            "https://ha.example.test/api/services/homeassistant/turn_on",
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    entity_id: "input_boolean.in_meeting",
                }),
            }
        );
    });

    it("turns entities off through Home Assistant services", async () => {
        await setEntityState(apiConfig, false);

        expect(global.fetch).toHaveBeenCalledWith(
            "https://ha.example.test/api/services/homeassistant/turn_off",
            expect.objectContaining({
                body: JSON.stringify({
                    entity_id: "input_boolean.in_meeting",
                }),
            })
        );
    });

    it("keeps webhook updates on the configured webhook URL", async () => {
        await setEntityState(
            {
                ...apiConfig,
                method: "webhook",
                webhook_url: "https://ha.example.test/api/webhook/meet",
            },
            true
        );

        expect(global.fetch).toHaveBeenCalledWith(
            "https://ha.example.test/api/webhook/meet",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    value: "on",
                }),
            }
        );
    });
});
