const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require("discord.js");
const { buttonHandlers } = require("../../functions/interactions/button");
const { modalHandlers } = require("../../functions/interactions/modal");

const ROUTE_PREFIX = "dank_market_gen";
const MODAL_PREFIX = "dank_market_modal";

async function handleMarketButton(interaction) {
  const parts = interaction.customId.split(":");
  const itemName = parts[1] || "unknown";
  const topBuy = parts[2] || "0";
  const topSell = parts[3] || "0";
  
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${itemName}`)
    .setTitle("Market Generator");
    
  const priceInput = new TextInputBuilder()
    .setCustomId("price")
    .setLabel("Price per unit")
    .setPlaceholder(`Top Buy: ${Number(topBuy).toLocaleString()} | Top Sell: ${Number(topSell).toLocaleString()}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
    
  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Amount you want to sell")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
    
  modal.addComponents(
    new ActionRowBuilder().addComponents(priceInput),
    new ActionRowBuilder().addComponents(amountInput)
  );
  
  await interaction.showModal(modal);
}

async function handleMarketModal(interaction) {
  const parts = interaction.customId.split(":");
  const itemName = parts[1] || "unknown";
  const priceRaw = interaction.fields.getTextInputValue("price").replace(/[^\d]/g, "");
  const amountRaw = interaction.fields.getTextInputValue("amount").replace(/[^\d]/g, "");
  
  const price = Number(priceRaw);
  const amount = Number(amountRaw);
  
  const total = price * amount;
  
  const command = `pls market post for_coins sell ${amount} ${itemName} ${total} 1 true`;
  
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Copy-Paste Command")
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### \`${command}\``)
    );
  
  await interaction.reply({
    components: [container],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleMarketButton);
}
if (!modalHandlers.has(MODAL_PREFIX)) {
  modalHandlers.set(MODAL_PREFIX, handleMarketModal);
}

module.exports = {
  ROUTE_PREFIX,
  MODAL_PREFIX,
  handleMarketButton,
  handleMarketModal,
};
