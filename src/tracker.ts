import {Connection, PublicKey, clusterApiUrl} from '@solana/web3.js';
import {getMint} from '@solana/spl-token';
import {Metaplex} from '@metaplex-foundation/js';
//import {Metadata} from '@metaplex-foundation/mpl-token-metadata';
import axios from 'axios';
import BigNumber from 'bignumber.js';

//--Configuration--
//Need to get a reliable RPC end point. Public ones are unreliable and slow.
// Consider using a paid service like QuickNode or Alchemy for production use.

const RPC_URL = process.env.RPC_URL || clusterApiUrl('mainnet-beta');
const connection = new Connection(RPC_URL, 'confirmed');

//Metaples Setup (using JS SDK)
const metaplex = Metaplex.make(connection);

// ---Helper Functions for BigNumber Conversion---
function convertToDecimal(amount:bigint | number, decimals:number):BigNumber {
    return new BigNumber(amount.toString()).shiftedBy(-decimals);
}

// --Main Tracking Fucntion--
interface TokenDetails {
    address: string;
    name?: string;
    symbol?: string;
    imageURL?: string;
    decimals: number;
    totalSupply: string; //Formatted total supply
    totalSupplyRaw: bigint; 
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
    price?:number;
    marketcCap?:number;
    liquidityUsd?:number; //Requires a DEX API to get the liquidity
    holders?:number;
    volume24h?:number; 
}

async function getTokenDetails(mintAddress: string): Promise<TokenDetails | null> {
    console.log(`Fetching details for mint: ${mintAddress}`);
    try{
        const mintPublicKey = new PublicKey(mintAddress);

        //1. Get Basic Mint Info (on-chain)
        console.log("Fetching mint info...");
        const mintInfo = await getMint(connection, mintPublicKey);
        const decimals = mintInfo.decimals;
        const totalSupplyRaw = mintInfo.supply; // Raw total supply
        const totalSupplyFormatted = convertToDecimal(totalSupplyRaw, decimals).toFormat(); // Formatted total supply


        console.log(`Supply: ${totalSupplyFormatted}, Decimals: ${decimals}`);

        //2. Get Metadata (On-chain PDA Address -> Off-Chain JSON)
        //Initalize metadata variable, they will be updted if data is found

        let tokenName: string | undefined = undefined;
        let tokenSymbol: string | undefined = undefined;
        let tokenImageURL: string | undefined = undefined;
     try { //I am using an inner try to metaplex and json fething, so errors don't stop everything

        console.log("Fetching Metaplex metadata...");
        //Using the Metaplex SDK to get metadata
        const nftOrToken = await metaplex.nfts().findByMint({ mintAddress: mintPublicKey });
        //data from the fetched JSOn if fields are empty in the on-chain meta data

        tokenName = nftOrToken.name;
        tokenSymbol = nftOrToken.symbol;
        const metadataUri = nftOrToken.uri;

        //Fetch the JSON metadata from the URI if it exists
        if (metadataUri) {
            try{
                console.log("Fetching JSON metadata from: ${metadataUri}");
                const response = await axios.get(metadataUri);
                tokenImageURL = response.data.image; //Assuming stanadard structure

                //You might want to parse other fields too (description, etc)

                if (!tokenName && response.data.name) tokenName = response.data.name;
                if (!tokenSymbol && response.data.symbol) tokenSymbol = response.data.symbol;

    }catch (jsonError: any) { //Added "any" type for error
        console.warn(`Could not fetch or parse metadata JSON from ${metadataUri}:`, jsonError.message); 

    }}
}catch (metaError:any){
    console.warn(`Could not find Metaplex metadata for ${mintAddress}:`, metaError.message);
    //Handle cases where no Metaplex metadata exists
}

// --- Data from External APIs (Example: Price Market Cap,Liquidity, Holders)---
//IMPORTANT: Choose a reliable API provider. Exampples:
// - Jupiter Price API: https://station.jup.ag/docs/api/price-api
// - Birdeye API: https://docs.birdeye.so/
// - Dexscreener API: https://docs.dexscreener.com/
// These often require API keys and have rate limits or commercial use cases.

let price: number | undefined = undefined;
let marketCap: number | undefined = undefined;
let liquidityUsd: number | undefined = undefined;
let holders: number | undefined = undefined;
let volume24h: number | undefined = undefined; //Hard to get accurately on-chain

//Example using a hypothetical Price/Data API (e.g., Birdeye - replace with actual API calls)
try {
    console.log("Fetching data from external API (e.g., Birdeye)...");
    //Replace with actual API call 
    const API_ENDPOINT = `https://public-api.birdeye.so/defi/price?address=${mintAddress}`;//Check Birdeye docs
    const HEADERS = {"X-API-Key": "YOUR_BRIDEYE_API"}; //Get API key from Birdeye

    // ---Price Fetch ---
    try{
        const priceResponse = await axios.get(API_ENDPOINT, { headers: HEADERS });
        if (priceResponse.data?.data?.value){
            price = priceResponse.data.data.value;
            console.log(`Price: ${price}`);
        }else{
            console.warn("Price data not found in API response.");
        }
    } catch(priceApiError: any){
        console.error("Error fetching price from API:", priceApiError.response?.data || priceApiError.message);
    }

    // ---Market Cap Fetch ---
    if (price !== undefined) {
        marketCap = convertToDecimal(totalSupplyRaw, decimals).multipliedBy(price).toNumber();
        console.log(`Market Cap: ${marketCap?.toLocaleString()}`);
    }

    //----Liquidity & holders (Example - Often requires different API calls)---
    // Birdeye API might provide liquidity or holders directly.

    const OVERVIEW_ENDPOINT = `https://public-api.birdeye.so/defi/token_overview?address=${mintAddress}`;
    try{
        const overviewResponse = await axios.get(OVERVIEW_ENDPOINT, { headers: HEADERS });
        //Check paths based on actual API response structure
        liquidityUsd = overviewResponse.data?.data?.liquidity;
        holders = overviewResponse.data?.data?.holders;
        volume24h = overviewResponse.data?.data?.volume24h;
        console.log(`Liquidity: ${liquidityUsd}, Holders: ${holders}, Volume 24h: ${volume24h}`);
    }catch(overviewApiError: any) {
        console.error("Error fetching overview data from API:", overviewApiError.response?.data || overviewApiError.message);
    }

} catch(apiError) {
    console.error("Error fetching data from external API:", apiError);
    //Continue without API data if it fails
    //You might want to set defaults or handle this case
}

//---Construct Final Token Details Object---
const result: TokenDetails = {
    address: mintAddress,
    name: tokenName || "N?A",
    symbol: tokenSymbol || "N/A",
    imageURL: tokenImageURL,
    decimals: decimals,
    totalSupply: totalSupplyFormatted,
    totalSupplyRaw: totalSupplyRaw,
    mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
    freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
    price: price,
    marketcCap: marketCap,
    liquidityUsd: liquidityUsd,
    holders: holders,
    volume24h: volume24h
};

return result
}
catch (error) {console.error(`Failed to get details for mint ${mintAddress}:`, error);
    return null; //Return null if any error occurs
}
}  

// ---Example Usage---
async function main() {
    const tokenAddress = process.argv[2]; //Get token address from command line argument

    if (!tokenAddress) {
        console.error("Please provide a solana token address as a command line argument.");
        console.log("Usage: ts-node tracker.ts <TOKEN_ADDRESS>");
        process.exit(1);
    } try{
        new PublicKey(tokenAddress); //Validate address format
    } catch{
        console.error("Invalid Solana token address format.");
        process.exit(1);
    }

    const tokenDetails = await getTokenDetails(tokenAddress);
    if (tokenDetails) {
        console.log("\nToken Details:");
        console.log(JSON.stringify(tokenDetails, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, //Convert BigInt for JSON stringify
              2));

              console.log("---------/n");
}else {
        console.log("No details found for the provided token address.");
    }

}

main()
