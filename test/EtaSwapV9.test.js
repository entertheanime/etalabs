const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('EtaSwapV9', function () {
  let trade;
  let nft;
  let creator;
  let counterparty;

  beforeEach(async function () {
    [creator, counterparty] = await ethers.getSigners();
    nft = await (await ethers.getContractFactory('EtaSwapNFT')).deploy();
    trade = await (await ethers.getContractFactory('EtaSwapV9')).deploy();

    await nft.connect(creator).mint(8);       // #1 through #8
    await nft.connect(counterparty).mint(8);  // #9 through #16
    await nft.connect(creator).setApprovalForAll(await trade.getAddress(), true);
    await nft.connect(counterparty).setApprovalForAll(await trade.getAddress(), true);
  });

  const erc721 = (tokenId) => ({
    contractAddress: ethers.ZeroAddress, // replaced in each test
    tokenId,
    amount: 1,
    standard: 0,
  });

  async function expectRevert(promise, reason) {
    try {
      await promise;
      expect.fail('Expected transaction to revert');
    } catch (error) {
      expect(String(error.message)).to.include(reason);
    }
  }

  it('settles a direct NFT swap without holding NFTs before acceptance', async function () {
    const nftAddress = await nft.getAddress();
    const offered = [{ ...erc721(1), contractAddress: nftAddress }];
    const requested = [{ ...erc721(9), contractAddress: nftAddress }];

    await trade.connect(creator).createTrade(counterparty.address, offered, requested, 0, 0, 'test', 3600);
    expect(await nft.ownerOf(1)).to.equal(creator.address);
    expect(await nft.ownerOf(9)).to.equal(counterparty.address);

    await trade.connect(counterparty).acceptTrade(1, { value: 0 });
    expect(await nft.ownerOf(1)).to.equal(counterparty.address);
    expect(await nft.ownerOf(9)).to.equal(creator.address);
  });

  it('rejects more than eight NFTs per side on-chain', async function () {
    const nftAddress = await nft.getAddress();
    const tooMany = Array.from({ length: 9 }, (_, index) => ({ ...erc721(index + 1), contractAddress: nftAddress }));
    await expectRevert(
      trade.connect(creator).createTrade(counterparty.address, tooMany, [], 0, 0, 'too many', 3600),
      'TOO_MANY_NFTS'
    );
  });

  it('rejects acceptance when an offered NFT was burned after the offer', async function () {
    const nftAddress = await nft.getAddress();
    await trade.connect(creator).createTrade(
      counterparty.address,
      [{ ...erc721(2), contractAddress: nftAddress }],
      [{ ...erc721(10), contractAddress: nftAddress }],
      0,
      0,
      'burn test',
      3600
    );
    await nft.connect(creator).burn(2);

    await expectRevert(
      trade.connect(counterparty).acceptTrade(1, { value: 0 }),
      'NFT_NOT_IN_WALLET'
    );
    expect((await trade.trades(1)).status).to.equal(BigInt(0));
  });

  it('rejects a duration outside 5 minutes to 1 day', async function () {
    const nftAddress = await nft.getAddress();
    await expectRevert(
      trade.connect(creator).createTrade(
        counterparty.address,
        [{ ...erc721(3), contractAddress: nftAddress }],
        [],
        0,
        0,
        'too short',
        60
      ),
      'INVALID_DURATION'
    );
  });

  it('expires the offer after the chosen duration', async function () {
    const nftAddress = await nft.getAddress();
    await trade.connect(creator).createTrade(
      counterparty.address,
      [{ ...erc721(4), contractAddress: nftAddress }],
      [{ ...erc721(11), contractAddress: nftAddress }],
      0,
      0,
      'expiry',
      300
    );
    await expectRevert(trade.expireTrade(1), 'TRADE_NOT_EXPIRED');
    await ethers.provider.send('evm_increaseTime', [301]);
    await ethers.provider.send('evm_mine', []);
    await trade.expireTrade(1);
    expect((await trade.trades(1)).status).to.equal(BigInt(3));
  });
});
