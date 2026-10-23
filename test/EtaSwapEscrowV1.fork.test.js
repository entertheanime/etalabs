const { expect } = require('chai');
const { ethers, network } = require('hardhat');
require('@nomicfoundation/hardhat-chai-matchers');

// All writes happen on Hardhat's local fork. Never sends transactions to the RPC.
(process.env.RUN_ESCROW_FORK === '1' ? describe : describe.skip)('Escrow with actual Robinhood collections (local fork)', function () {
  this.timeout(180000);
  before(async function () {
    if (network.name !== 'hardhat') throw new Error('Fork tests require the local hardhat network');
    await network.provider.request({method:'hardhat_reset',params:[{forking:{jsonRpcUrl:'https://rpc.mainnet.chain.robinhood.com'}}]});
  });
  after(async function () { await network.provider.request({method:'hardhat_reset',params:[]}); });

  for (const [collection, address, tokenId] of [
    ['melo','0xf8a4db4ee5eaff90b1a6384f0a72021c3f965ae2',1237],
    ['Hood Andy','0x19bf832b4ab89b86bb0cb44c8abeb7a3a879f7d5',78],
  ]) {
    it(`${collection}: direct deposit, atomic NFT-for-NFT exchange, and cancellation refund`, async function () {
      const [deployer, recipient] = await ethers.getSigners();
      const escrow = await (await ethers.getContractFactory('EtaSwapEscrowV1')).deploy(deployer.address);
      const other = await (await ethers.getContractFactory('OwnerDirectNFT')).deploy();
      await other.mint(recipient.address,1);
      const nft = new ethers.Contract(address,[
        'function ownerOf(uint256) view returns(address)',
        'function safeTransferFrom(address,address,uint256,bytes)',
      ],ethers.provider);
      const originalOwner = await nft.ownerOf(tokenId);
      await network.provider.request({method:'hardhat_impersonateAccount',params:[originalOwner]});
      await network.provider.send('hardhat_setBalance',[originalOwner,'0x8AC7230489E80000']);
      const holder = await ethers.getSigner(originalOwner);
      const item = {token:address,id:tokenId,amount:1,standard:0};
      const tag = (id,side) => ethers.AbiCoder.defaultAbiCoder().encode(['uint256','uint256','uint256'],[id,side,0]);
      await escrow.connect(holder).createTrade(recipient.address,[item],[{token:other.target,id:1,amount:1,standard:0}],0,0,3600);
      await nft.connect(holder).safeTransferFrom(originalOwner,escrow.target,tokenId,tag(1,0));
      await other.connect(recipient)['safeTransferFrom(address,address,uint256,bytes)'](recipient.address,escrow.target,1,tag(1,1));
      await escrow.connect(recipient).acceptTrade(1);
      expect(await nft.ownerOf(tokenId)).to.equal(recipient.address);
      expect(await other.ownerOf(1)).to.equal(originalOwner);
      await escrow.connect(recipient).createTrade(originalOwner,[item],[],0,0,3600);
      await nft.connect(recipient).safeTransferFrom(recipient.address,escrow.target,tokenId,tag(2,0));
      await escrow.connect(recipient).cancelTrade(2);
      await escrow.connect(recipient).refundNFT(2,0,0,recipient.address);
      expect(await nft.ownerOf(tokenId)).to.equal(recipient.address);
      await network.provider.request({method:'hardhat_stopImpersonatingAccount',params:[originalOwner]});
    });
  }
});
