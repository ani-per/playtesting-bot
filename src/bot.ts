import {
    Client,
    GatewayIntentBits,
    Partials,
    ChannelType,
    Interaction,
    TextChannel,
    TextThreadChannel,
    Events,
    EmbedBuilder,
    MessageCreateOptions,
    Message,
} from "discord.js";
import { config } from "./config";
import handleTossupPlaytest from "./handlers/tossupHandler";
import handleBonusPlaytest from "./handlers/bonusHandler";
import handleNewQuestion from "./handlers/newQuestionHandler";
import handleConfig from "./handlers/configHandler";
import handleButtonClick from "./handlers/buttonClickHandler";
import handleCategoryCommand from "./handlers/categoryCommandHandler";
import handleTally from "./handlers/bulkQuestionHandler";
import { sleep, QuestionType, UserBonusProgress, UserProgress, UserTossupProgress, getBulkQuestions, getBulkQuestionsInPacket, getServerChannels, getServerSettings, saveEchoSetting, deleteEchoSetting, getEchoThreadId, updatePacketName, getEchoSettings, cleanPacketName, printPacketName, deleteBulkPacket } from "./utils";
import handleAuthorCommand from "./handlers/authorCommandHandler";

const userProgressMap = new Map<string, UserProgress>();

const startCommands = ["start", "read", "begin"];
const getCommands = ["packet", "status", "round", "info"];
const stopCommands = ["stop", "quit"];
const clearCommands = ["reset", "clear"];
const helpCommands = ["commands", "help"];
const packetCommands = [
    ...startCommands,
    ...stopCommands,
    ...getCommands,
];
const tallyCommands = [
    ...startCommands,
    ...stopCommands,
    "tally", "count",
];
const deleteCommands = ["delete", "purge"];

const helpEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle("Overview")
    .setURL("https://github.com/ani-per/playtesting-bot")
    .setAuthor({ name: "Playtesting Bot", url: "https://github.com/ani-per/playtesting-bot" })
    .setDescription([
        "* [README](https://github.com/ani-per/playtesting-bot/blob/main/README.md)",
        "* [Instructions for Editors](https://gist.github.com/acfquizbowl/7983064671e257b15de96547ef192129#instructions-for-editors)",
        "* [Instructions for Playtesters](https://gist.github.com/acfquizbowl/7983064671e257b15de96547ef192129#instructions-for-playtesters)",
        "* [Paster Dingus](https://minkowski.space/quizbowl/paster/)",
        "* [File an issue on GitHub](https://github.com/JemCasey/playtesting-bot/issues)",
    ].join("\n")
    )
    .addFields(
        { name: "Bot Configuration", value: "`!config`" },
        {
            name: "Bulk Playtesting Commands",
            value: [
                "* `!start X`/`!read X`/`!begin X` - Begin reading packet `X`",
                "* `!packet`/`!round` - Display current packet",
                "* `!stop`/`!quit` - Stop reading the current packet",
                "* `!delete X` - Delete packet `X` and its questions",
                "* `!tally` - Tally reacts for the current packet",
                "* `!tally X` - Tally reacts for packet `X`",
            ].join("\n"),
        },
    )
    .setTimestamp();

export type Sendable = {
    send(
        payload: string | MessageCreateOptions
    ): Promise<Message>;
};

export type SafeSendDestination = Sendable | Message;

export async function safeSend(
    destination: SafeSendDestination,
    payload: string | MessageCreateOptions,
    operation: "send" | "reply" = "send",
    context?: string
): Promise<Message> {
    const callSite = new Error("Discord send/reply call site");

    // Prevent Discord from receiving an empty message.
    if (typeof payload === "string" && payload.trim() === "") {
        throw new Error("Cannot send an empty Discord message.");
    }

    try {
        if (operation === "reply") {
            return await (destination as Message).reply(payload);
        }

        return await (destination as Sendable).send(payload);
    } catch (error: unknown) {
        console.error("========== DISCORD SEND FAILED ==========");
        console.error("Operation:", operation);

        if (context) {
            console.error("Context:", context);
        }

        console.error("Payload:", payload);

        if (error instanceof Error) {
            console.error("Error:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: "code" in error ? error.code : undefined,
            });
        } else {
            console.error("Unknown error:", error);
        }

        console.error("CALL SITE:");
        console.error(callSite.stack);

        console.error("==========================================");

        throw error;
    }
}

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction
    ],
    allowedMentions: {
        parse: []
    }
});

client.once(Events.ClientReady, async (client) => {
    let emojis = await client?.application?.emojis.fetch();
    console.log(`Logged in as ${client.user.tag} with ${emojis.size} application emojis.`);
    let emojiList = emojis.map(e => `\t${e.name}`).join("\n");
    // console.log(emojiList);
});

client.on("messageCreate", async (message) => {
    try {
        if (message.author.id === config.DISCORD_APPLICATION_ID)
            return;
        if (message.content.startsWith("!config")) {
            await handleConfig(message);
        } else if (
            [...packetCommands, ...tallyCommands, ...deleteCommands, ...helpCommands].some(
                v => message.content.startsWith("!" + v)
            )
        ) {
            let serverId = message.guild!.id;
            let echoChannelId = getServerChannels(serverId).find(c => (c.channel_type === 3))?.channel_id;
            let currentServerSetting = getServerSettings(serverId).find(ss => ss.server_id == serverId);
            let currentPacket = currentServerSetting?.packet_name || "";
            let splits = message.content.split(" ");
            let command = splits[0];
            let packetArgument = splits.length > 1 ? splits.slice(1).join(" ").trim() : "";
            let cleanedPacketName = cleanPacketName(packetArgument);
            let startPacket = startCommands.some(v => command.startsWith("!" + v));
            let clearPacket = clearCommands.some(v => packetArgument.startsWith(v));
            let endPacket = stopCommands.some(v => command.startsWith("!" + v)) || clearPacket;
            let getPacket = getCommands.some(v => command.startsWith("!" + v));
            let noPacket = false;
            let packetToTally = cleanPacketName(packetArgument);
            if (packetCommands.some(v => message.content.startsWith("!" + v))) {
                if (endPacket || startPacket) {
                    if (
                        startPacket &&
                        packetArgument &&
                        (cleanedPacketName === currentPacket)
                    ) {
                        safeSend(message, `${printPacketName(cleanedPacketName)} is already being read.`, "reply");
                    } else {
                        if (
                            endPacket ||
                            (
                                startPacket &&
                                currentPacket &&
                                packetArgument
                            )
                        ) {
                            let endMessageArray = [""];
                            let closingVerb = "";
                            if (
                                stopCommands.some(v => command.startsWith("!" + v)) ||
                                packetArgument.startsWith("end") ||
                                (startPacket && currentPacket)
                            ) {
                                closingVerb = "ended";
                            } else {
                                closingVerb = "been cleared";
                            }
                            if (currentPacket) {
                                updatePacketName(serverId, "");
                                packetToTally = currentPacket;
                                endMessageArray.push(`Reading of ${printPacketName(currentPacket)} has ${closingVerb}.`);
                            } else if (packetArgument) {
                                // console.log(`Ending or starting packet ${cleanedPacketName}.`);
                                updatePacketName(serverId, "");
                                let packetBulkQuestions = getBulkQuestionsInPacket(serverId, cleanedPacketName);
                                if (packetBulkQuestions.length > 0) {
                                    endMessageArray.push(`${printPacketName(cleanedPacketName)} ${closingVerb}.`);
                                } else {
                                    endMessageArray.push(`${printPacketName(cleanedPacketName)} not found.`);
                                }
                            } else {
                                noPacket = true;
                                // endMessageArray.push(`No packet is being read, and you did not specify a packet in your command to stop or end.`);
                            }
                            if (
                                startPacket &&
                                currentPacket &&
                                packetArgument
                            ) {
                                endMessageArray.push(`Preparing to read ${printPacketName(cleanedPacketName)} ...`);
                            }
                            let endMessage = endMessageArray.join(" ");
                            if (endMessage) {
                                safeSend(message, endMessage, "reply");
                            }
                        }
                        if (startPacket && packetArgument) {
                            // console.log(`Starting packet ${cleanedPacketName}.`);
                            let newPacketName = updatePacketName(serverId, cleanedPacketName);
                            currentPacket = newPacketName;
                            let printPacket = printPacketName(currentPacket);
                            if (echoChannelId) {
                                let echoChannel = (client.channels.cache.get(echoChannelId) as TextChannel);
                                let echoThreadId = getEchoThreadId(serverId, echoChannelId, newPacketName);
                                if (!echoThreadId) {
                                    let packetMessage = await safeSend(echoChannel, `## [${printPacket}](${message.url})`);
                                    if (packetMessage) {
                                        let newEchoThread = await packetMessage.startThread({
                                            name: printPacket.replaceAll("\`", ""),
                                            autoArchiveDuration: 60
                                        });
                                        saveEchoSetting(serverId, echoChannelId, newPacketName, newEchoThread?.id);
                                        safeSend(message, `Reading of [${printPacket}](${newEchoThread.url}) has begun.`, "reply");
                                    }
                                } else {
                                    // console.log("Looking for packet name.")
                                    let echoThread = echoChannel!.threads.cache.find(x => x.id === echoThreadId) as TextThreadChannel;
                                    safeSend(message, `Resumed reading of [${printPacket}](${echoThread?.url || ""}).`, "reply");
                                }
                            } else {
                                safeSend(message, "Could not begin reading. An echo channel has not been configured.", "reply");
                            }
                        }
                    }
                } else if (getPacket) {
                    if (packetArgument) {
                        let packetBulkQuestions = getBulkQuestionsInPacket(serverId, cleanedPacketName);
                        safeSend(message, `${packetBulkQuestions.length} questions have been read as part of ${printPacketName(cleanedPacketName)}.`, "reply");
                    } else if (currentPacket) {
                        safeSend(message, `The current packet is ${printPacketName(currentPacket)}.`, "reply");
                    } else {
                        noPacket = true;
                        // safeSend(message, `No packet is being read, and you did not specify a packet in your command to check the status.`, "reply");
                    }
                }
            }
            if (tallyCommands.some(v => command.startsWith("!" + v))) {
                if (packetToTally) {
                    if (packetToTally.includes("all")) {
                        [...new Set(getBulkQuestions(serverId).map(u => u.packet_name))].forEach(async packet => {
                            let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packet);
                            if (tallyBulkQuestions.length > 0) {
                                await handleTally(serverId, packet, message);
                            } else {
                                safeSend(message, `No questions to tally in Packet ${packet}.`, "reply");
                            }
                        });
                    } else if (
                        !(startPacket && (packetToTally === currentPacket))
                    ) {
                        let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packetToTally);
                        if (tallyBulkQuestions.length > 0) {
                            await handleTally(serverId, packetToTally, message);
                        } else {
                            safeSend(message, `No questions to tally in Packet \`${packetToTally}\`.`, "reply");
                        }
                    }
                } else {
                    if (endPacket && currentPacket) {
                        await handleTally(serverId, currentPacket, message);
                    } else if (packetArgument) {
                        noPacket = true;
                    }
                }
            }
            if (noPacket) {
                safeSend(message, "No packet is being read right now.", "reply");
            }
            if (deleteCommands.some(v => command.startsWith("!" + v))) {
                if (packetArgument) {
                    if (echoChannelId) {
                        let deleteMessage = [""];
                        let echoSetting = getEchoSettings(serverId, echoChannelId).find(es => es.packet_name === cleanedPacketName);
                        if (echoSetting) {
                            deleteEchoSetting(serverId, cleanedPacketName);
                            let echoChannel = (client.channels.cache.get(echoSetting.channel_id) as TextChannel);
                            let echoThread = echoChannel!.threads.cache.find(x => x.id === echoSetting.thread_id) as TextThreadChannel;
                            let echoMessage = await echoChannel!.messages.fetch(echoSetting.thread_id);
                            if (echoMessage) {
                                await echoMessage.delete();
                            }
                            await echoThread?.delete();
                            deleteBulkPacket(serverId, cleanedPacketName);
                            if (currentPacket === cleanedPacketName) {
                                updatePacketName(serverId, "");
                                deleteMessage.push(`Reading of ${printPacketName(currentPacket)} has ended.`);
                            }
                            deleteMessage.push(`${printPacketName(cleanedPacketName)} and its associated thread have been deleted.`);
                            safeSend(message, deleteMessage.join(" "), "reply");
                        } else {
                            safeSend(message, `${printPacketName(cleanedPacketName)} does not exist.`, "reply");
                        }
                    } else {
                        safeSend(message, "Echo channel not configured.", "reply");
                    }
                } else {
                    safeSend(message, "No packet name was provided to delete settings.", "reply");
                }
            }
            if (helpCommands.some(v => message.content.startsWith("!" + v))) {
                await sleep(1000);
                safeSend(message, { embeds: [helpEmbed] }, "reply")
            }
        } else if (message.content.startsWith("!category")) {
            await handleCategoryCommand(message);
        } else if (message.content.startsWith("!author")) {
            await handleAuthorCommand(message);
        } else {
            let setUserProgress = userProgressMap.set.bind(userProgressMap);
            let deleteUserProgress = userProgressMap.delete.bind(userProgressMap);

            if (message.channel.type !== ChannelType.DM && message.content.includes("ANSWER:")) {
                await handleNewQuestion(message);
            } else if (message.channel.type === ChannelType.DM) {
                let userProgress = userProgressMap.get(message.author.id)

                if (userProgress?.type === QuestionType.Tossup) {
                    await handleTossupPlaytest(message, client, userProgress as UserTossupProgress, setUserProgress, deleteUserProgress);
                } else if (userProgress?.type === QuestionType.Bonus) {
                    await handleBonusPlaytest(message, client, userProgress as UserBonusProgress, setUserProgress, deleteUserProgress);
                }
            }
        }
    } catch (e) {
        console.log(e);
    }
});

client.on("interactionCreate", async (interaction: Interaction) => {
    try {
        await handleButtonClick(interaction, userProgressMap, userProgressMap.set.bind(userProgressMap));
    } catch (e) {
        console.log(e);
    }
});

client.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    process.exit(1); // PM2 will now see the exit and restart the bot
});

client.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
});

client.login(config.DISCORD_TOKEN);
