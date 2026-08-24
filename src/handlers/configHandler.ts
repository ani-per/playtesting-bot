import { Message, TextChannel } from "discord.js";
import { safeSend } from "src/bot"
import { SECRET_ROLE } from "src/constants";
import { saveAsyncServerChannelsFromMessage, saveBulkServerChannelsFromMessage, deleteServerChannelsCommand, deleteServerSettingsCommand, insertServerSettingCommand } from "src/utils";

export default async function handleConfig(message: Message<boolean>) {
    const msgChannel = (await message.channel.fetch() as TextChannel);

    await safeSend(msgChannel, "List the channels used for **internal, asynchronous playtesting** - where the results should be saved to a separate channel.\nList channels in the form: `#testing-channel-1 / #results-channel-1 #testing-channel-2 / #results-channel-2`.");
    await safeSend(msgChannel, "To bypass asynchronous playtesting channels, type `#/#`.\nNote that multiple playtesting channels can share a `results-channel`.");

    try {
        let filter = (m: Message<boolean>) => m.author.id === message.author.id
        let collected = await msgChannel.awaitMessages({
            filter,
            max: 1
        });

        deleteServerChannelsCommand.run(message.guild!.id);
        deleteServerSettingsCommand.run(message.guild!.id);

        let async_channels = saveAsyncServerChannelsFromMessage(collected, message.guild!);

        if (async_channels.length > 0) {
            await safeSend(msgChannel, `Successfully saved ${async_channels.join(", ")} as asynchronous playtesting channels.`);

            await safeSend(msgChannel, `**Note**: If you would like question answers and player notes to be encrypted in the bot's database, create a role called \`${SECRET_ROLE}\`.`);
        } else {
            await safeSend(msgChannel, `No asynchronous channels configured.`);
        }

        await safeSend(msgChannel, "List the channels used for **bulk playtesting** - where playtesters will use reacts to indicate their performance.\nUse the form: `#testing-channel-1 #testing-channel-2`.");
        await safeSend(msgChannel, "To bypass bulk playtesting channels, type `#`.\nAsynchronous playtesting channels cannot be bulk playtesting channels.");

        try {
            let filter = (m: Message<boolean>) => m.author.id === message.author.id
            let collected = await msgChannel.awaitMessages({
                filter,
                max: 1
            });

            let bulk_channels = saveBulkServerChannelsFromMessage(collected, message.guild!, 2);

            if (bulk_channels.length > 0) {
                await safeSend(msgChannel, `Successfully saved ${bulk_channels.join(", ")} as bulk playtesting channels.`);
                await safeSend(msgChannel, "It is strongly recommended to have the questions for bulk playtesting echoed into another channel for convenient perusal afterwards.\nList the echo channel in the form: `#echo-channel`.");
                await safeSend(msgChannel, "To bypass the echo channel, type `#`.\nAsynchronous and bulk playtesting channels cannot be echo channels.");

                try {
                    let filter = (m: Message<boolean>) => m.author.id === message.author.id
                    let collected = await msgChannel.awaitMessages({
                        filter,
                        max: 1
                    });

                    let echo_channel = saveBulkServerChannelsFromMessage(collected, message.guild!, 3);

                    await safeSend(msgChannel, `Successfully saved ${echo_channel.join(", ")} as the echo channel.`);

                    insertServerSettingCommand.run(message.guildId!, "");
                } catch (err) {
                    console.log("Error in echo channel config: " + err);
                    await safeSend(msgChannel, "An error occurred, please try again.");
                }

                await safeSend(msgChannel, "Configuration finished.");
            } else {
                await safeSend(msgChannel, "Configuration finished.");
            }
        } catch (err) {
            console.log("Error in bulk channel config: " + err);
            await safeSend(msgChannel, "An error occurred, please try again.");
        }
    } catch (err) {
        console.log("Error in async channel config: " + err);
        await safeSend(msgChannel, "An error occurred, please try again.");
    }
}
