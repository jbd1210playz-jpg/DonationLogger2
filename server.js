const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

// Use the canvas package for image generation
// If it fails to load, the server still starts and falls back to embed-only posts
let canvasModule = null;
let canvasLoadError = null;
try {
	canvasModule = require('canvas');
	const { createCanvas, loadImage, GlobalFonts } = canvasModule;

	// Register fonts if available (optional - falls back to default)
	try {
		const fontPaths = [
			'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
			'/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'
		];
		for (const p of fontPaths) {
			try {
				GlobalFonts.registerFromPath(p, 'DejaVu Sans');
				break;
			} catch (e) { /* try next path */ }
		}
	} catch (e) {
		console.warn('⚠️ Font registration skipped, using default font');
	}

	console.log('✅ Canvas loaded successfully');
} catch (error) {
	canvasLoadError = error.message;
	console.error('❌ Canvas failed to load - image generation disabled:', error.message);
	console.error('The server will still run and post text embeds to Discord.');
}

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Middleware to log requests
app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

// Health check endpoint
app.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		imageGeneration: canvasModule ? 'enabled' : 'disabled', canvasError: canvasLoadError
	});
});

// Helper function to format numbers with commas
function formatNumber(num) {
	return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Helper function to get Roblox avatar headshot URL
async function getRobloxHeadshotUrl(userId) {
	try {
		const response = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
		if (response.data && response.data.data && response.data.data.length > 0) {
			return response.data.data[0].imageUrl;
		}
	} catch (error) {
		console.warn(`Failed to fetch avatar URL for user ${userId}:`, error.message);
	}
	return null;
}

// Helper function to fetch Roblox username from userId
async function getRobloxUsername(userId) {
	try {
		const response = await axios.post('https://users.roblox.com/v1/users', {
			userIds: [userId],
			excludeBannedUsers: false
		});
		if (response.data && response.data.data && response.data.data.length > 0) {
			return response.data.data[0].name;
		}
		return null;
	} catch (error) {
		console.warn(`Failed to fetch username for userId ${userId}:`, error.message);
		return null;
	}
}

// Generate donation image
async function generateDonationImage(donorName, donorUserId, recipientName, recipientUserId, amount, message, tier, color, rim, effects) {
	const { createCanvas, loadImage } = canvasModule;

	// Canvas dimensions
	const width = 1400;
	const height = 400;

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');

	// Transparent background with fade only at the bottom
	ctx.clearRect(0, 0, width, height);

	// Tier-colored gradient fade at the bottom - ONLY for the 1m and 10m tiers
	// No fade for the 100k tier or amounts below 1m
	if (rim || effects) {
		const tierColor = color || '#ff1493';
		const r = parseInt(tierColor.slice(1, 3), 16);
		const g = parseInt(tierColor.slice(3, 5), 16);
		const b = parseInt(tierColor.slice(5, 7), 16);
		const gradient = ctx.createLinearGradient(0, height, 0, height * 0.4);
		gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.8)`);
		gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.4)`);
		gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, width, height);
	}

	// Helper function for text with fill and black outline
	const drawText = (text, x, y, size, fillColor, strokeWidth = 8) => {
		ctx.font = `bold ${size}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';

		// Black outline
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = strokeWidth;
		ctx.strokeText(text, x, y);

		// Fill color
		ctx.fillStyle = fillColor;
		ctx.fillText(text, x, y);
	};

	// Load avatar images and custom emoji
	let donorAvatar, recipientAvatar, customEmoji;

	try {
		const donorAvatarUrl = await getRobloxHeadshotUrl(donorUserId);
		if (donorAvatarUrl) {
			donorAvatar = await loadImage(donorAvatarUrl);
		}
	} catch (error) {
		console.warn('Failed to load donor avatar');
	}

	try {
		const recipientAvatarUrl = await getRobloxHeadshotUrl(recipientUserId);
		if (recipientAvatarUrl) {
			recipientAvatar = await loadImage(recipientAvatarUrl);
		}
	} catch (error) {
		console.warn('Failed to load recipient avatar');
	}

	// Load tier emoji: starfall (10m+), smite (1m+), nuke (100k+)
	const tierEmojiIds = {
		'10m': '1574111560152911912',
		'1m': '1574111420491243600',
		'100k': '1574112430391296130'
	};
	const emojiId = tierEmojiIds[tier] || tierEmojiIds['100k'];
	try {
		const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.webp?size=96`;
		customEmoji = await loadImage(emojiUrl);
	} catch (error) {
		console.warn('Failed to load custom emoji');
	}

	// Avatar settings
	const avatarSize = 110;
	const avatarY = 140;
	const leftAvatarX = 220;
	const rightAvatarX = 1180;

	// Draw donor avatar (left side) with hot pink border
	if (donorAvatar) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(leftAvatarX, avatarY, avatarSize, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		ctx.drawImage(donorAvatar, leftAvatarX - avatarSize, avatarY - avatarSize, avatarSize * 2, avatarSize * 2);
		ctx.restore();
	}

	// Draw recipient avatar (right side) with hot pink border
	if (recipientAvatar) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(rightAvatarX, avatarY, avatarSize, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		ctx.drawImage(recipientAvatar, rightAvatarX - avatarSize, avatarY - avatarSize, avatarSize * 2, avatarSize * 2);
		ctx.restore();
	}

	// Draw custom Discord emoji directly in front of the first number, same size as the amount
	const emojiSize = 100;
	const amountX = 700;
	const iconY = 120;

	if (customEmoji) {
		ctx.font = 'bold 100px sans-serif';
		const amountWidth = ctx.measureText(formatNumber(amount)).width;
		const emojiX = amountX - (amountWidth / 2) - emojiSize - 10;
		ctx.drawImage(customEmoji, emojiX, iconY - emojiSize / 2, emojiSize, emojiSize);
	}

	// Draw amount with tier color fill and black outline
	const formattedAmount = formatNumber(amount);
	const amountColor = color || '#ff1493';

	if (tier === '10m') {
		// Neon glow behind the amount ONLY for the 10m tier
		ctx.save();
		ctx.shadowColor = amountColor;
		ctx.shadowBlur = 35;
		drawText(formattedAmount, amountX, 120, 100, amountColor, 10);
		ctx.restore();
	} else {
		// No glow for 1m, 100k, and below - plain bold text with black outline
		drawText(formattedAmount, amountX, 120, 100, amountColor, 12);
	}

	// Draw "donated to" text
	drawText('donated to', 700, 230, 60, '#FFFFFF', 8);

	// Draw donor name below left avatar
	drawText(`@${donorName}`, leftAvatarX, 310, 36, '#FFFFFF', 6);

	// Draw recipient name below right avatar
	drawText(`@${recipientName}`, rightAvatarX, 310, 36, '#FFFFFF', 6);

	return canvas.toBuffer('image/png');
}

// Donation logging endpoint
app.post('/api/donation', async (req, res) => {
	try {
		const {
			playerName,
			userId,
			recipientName,
			recipientUserId,
			amount,
			message,
			timestamp,
			color,
			tier,
			rim,
			effects
		} = req.body;

		// Validate required fields
		if (!playerName || !userId || !amount) {
			return res.status(400).json({
				error: 'Missing required fields: playerName, userId, amount'
			});
		}

		// Validate Discord webhook is configured
		if (!DISCORD_WEBHOOK_URL) {
			console.error('Discord webhook URL not configured');
			return res.status(500).json({ error: 'Server misconfigured' });
		}

		console.log(`Generating donation image: ${playerName} → ${recipientName || 'Game'} - ${amount} Robux`);

		// Fetch usernames from Roblox API to ensure accuracy
		let donorUsername = playerName;
		let recipientUsername = recipientName || 'Game';

		try {
			const fetchedDonorName = await getRobloxUsername(userId);
			if (fetchedDonorName) donorUsername = fetchedDonorName;

			if (recipientUserId) {
				const fetchedRecipientName = await getRobloxUsername(recipientUserId);
				if (fetchedRecipientName) recipientUsername = fetchedRecipientName;
			}
		} catch (error) {
			console.warn('Failed to fetch some usernames, using provided names');
		}

		const formData = new FormData();
		let embed;

		if (canvasModule) {
			// Generate the donation image
			const imageBuffer = await generateDonationImage(
				donorUsername,
				userId,
				recipientUsername,
				recipientUserId || userId,
				amount,
				message,
				tier,
				color,
				rim,
				effects
			);

			// Add the image
			formData.append('file', imageBuffer, {
				filename: 'donation.png',
				contentType: 'image/png'
			});

			// Embed with the generated image
			embed = {
				color: 0xff00ff,
				image: {
					url: 'attachment://donation.png'
				}
			};
		} else {
			// Fallback: text embed only (canvas unavailable)
			console.warn('Canvas not available - posting text embed only');
			embed = {
				color: 0xff00ff,
				title: '💰 Donation',
				description: `**@${donorUsername}** donated **${formatNumber(amount)} Robux** to **@${recipientUsername}**!`,
				footer: { text: 'Image generation unavailable' }
			};
		}

		const payload = {
			content: `<:robux:1487124460308922419> \`@${donorUsername}\` donated **${formatNumber(amount)} Robux** to \`@${recipientUsername}\`!`,
			embeds: [embed]
		};

		formData.append('payload_json', JSON.stringify(payload));

		// Send to Discord
		await axios.post(DISCORD_WEBHOOK_URL, formData, {
			headers: formData.getHeaders()
		});

		console.log(`✅ Donation logged: ${donorUsername} (${userId}) → ${recipientUsername} - ${amount} Robux`);
		res.json({ success: true, message: 'Donation logged successfully' });

	} catch (error) {
		console.error('Error logging donation:', error.message);

		if (error.response) {
			console.error('Discord API error:', error.response.data);
		}

		res.status(500).json({
			error: 'Failed to log donation',
			details: error.message
		});
	}
});

// Start server
app.listen(PORT, () => {
	console.log(`🚀 Donation Logger API running on port ${PORT}`);
	console.log(`📡 Endpoint: http://localhost:${PORT}/api/donation`);
	console.log(`💚 Health check: http://localhost:${PORT}/health`);
	console.log(`🎨 Image generation: ${canvasModule ? 'ENABLED' : 'DISABLED (canvas not loaded)'}`);

	if (!DISCORD_WEBHOOK_URL) {
		console.warn('⚠️  WARNING: DISCORD_WEBHOOK_URL not set in environment variables');
	}
});
