const { expect } = require('chai');
const { ethers } = require('hardhat');
require('@nomicfoundation/hardhat-chai-matchers');

describe('EtaSwapEscrowV1 direct deposit escrow', function () {
  let escrow, nft, multi, alice, bob, stranger, collector;
  const data = (id, side, index) => ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'uint256'], [id, side, index]);
  const item = (token, id, amount = 1, standard = 0) => ({ token, id, amount, standard });
  beforeEach(async function () {
    [alice, bob, stranger, collector] = await ethers.getSigners();
    escrow = await (await ethers.getContractFactory('EtaSwapEscrowV1')).deploy(collector.address);
    nft = await (await ethers.getContractFactory('OwnerDirectNFT')).deploy();
    multi = await (await ethers.getContractFactory('TestERC1155')).deploy();
    await nft.mint(alice.address, 1); await nft.mint(bob.address, 2);
    await multi.mint(alice.address, 10, 20);
  });
  async function create(offered, requested, eth = 0, requestedETH = 0, counterparty = bob.address, value = eth) {
    return escrow.createTrade(counterparty, offered, requested, eth, requestedETH, 3600, { value });
  }
  async function deposit(who, tokenId, side, tradeId = 1, index = 0) {
    return nft.connect(who)['safeTransferFrom(address,address,uint256,bytes)'](who.address, escrow.target, tokenId, data(tradeId, side, index));
  }
  async function pair() {
    await create([item(nft.target, 1)], [item(nft.target, 2)]);
    await deposit(alice, 1, 0); await deposit(bob, 2, 1);
  }
  it('settles owner-only NFTs that reject an approved marketplace pull', async function () {
    await nft.setApprovalForAll(stranger.address, true);
    await expect(nft.connect(stranger).transferFrom(alice.address, bob.address, 1)).to.be.revertedWith('OPERATOR_BLOCKED');
    await pair();
    expect(await nft.ownerOf(1)).to.equal(escrow.target);
    await escrow.connect(bob).acceptTrade(1);
    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect(await nft.ownerOf(2)).to.equal(alice.address);
    expect((await escrow.trades(1)).status).to.equal(1n);
    expect(await escrow.reserved721(nft.target, 1)).to.equal(0n);
    await expect(escrow.connect(bob).acceptTrade(1)).to.be.revertedWith('NOT_PENDING');
  });
  it('rejects incomplete deposits and unauthorized acceptance', async function () {
    await create([item(nft.target, 1)], [item(nft.target, 2)]);
    await deposit(alice, 1, 0);
    await expect(escrow.connect(bob).acceptTrade(1)).to.be.revertedWith('MISSING_DEPOSIT');
    await expect(escrow.connect(stranger).acceptTrade(1)).to.be.revertedWith('COUNTERPARTY_ONLY');
    expect(await nft.ownerOf(1)).to.equal(escrow.target);
  });
  it('rejects wrong slot, wrong NFT, wrong collection, and untagged safe sends', async function () {
    await create([item(nft.target, 1)], []);
    await expect(deposit(alice, 1, 1)).to.be.revertedWith('INVALID_SLOT');
    await nft.mint(alice.address, 3);
    await expect(deposit(alice, 3, 0)).to.be.revertedWith('WRONG_ASSET');
    await expect(multi.safeTransferFrom(alice.address, escrow.target, 10, 1, data(1, 0, 0))).to.be.revertedWith('WRONG_ASSET');
    await expect(nft['safeTransferFrom(address,address,uint256)'](alice.address, escrow.target, 1)).to.be.revertedWith('DEPOSIT_DATA_REQUIRED');
    expect(await nft.ownerOf(1)).to.equal(alice.address);
  });
  it('requires the named depositor and rejects approved operators for ERC1155', async function () {
    await create([item(multi.target, 10, 2, 1)], []);
    await multi.setApprovalForAll(stranger.address, true);
    await expect(multi.connect(stranger).safeTransferFrom(alice.address, escrow.target, 10, 2, data(1,0,0))).to.be.revertedWith('OWNER_DIRECT_ONLY');
    await multi.mint(stranger.address, 10, 2);
    await expect(multi.connect(stranger).safeTransferFrom(stranger.address, escrow.target, 10, 2, data(1,0,0))).to.be.revertedWith('OWNER_DIRECT_ONLY');
  });
  it('tracks ERC1155 quantities across trades without double allocation', async function () {
    const offered = [item(multi.target, 10, 3, 1)];
    await create(offered, []); await create(offered, []);
    await expect(multi.safeTransferFrom(alice.address, escrow.target, 10, 4, data(1,0,0))).to.be.revertedWith('WRONG_ASSET');
    for (const id of [1,2]) await multi.safeTransferFrom(alice.address, escrow.target, 10, 3, data(id,0,0));
    await expect(multi.safeTransferFrom(alice.address, escrow.target, 10, 3, data(1,0,0))).to.be.revertedWith('ALREADY_DEPOSITED');
    expect(await escrow.reserved1155(multi.target, 10)).to.equal(6n);
    await escrow.connect(bob).acceptTrade(1);
    await escrow.cancelTrade(2); await escrow.refundNFT(2,0,0,alice.address);
    expect(await multi.balanceOf(bob.address,10)).to.equal(3n);
    expect(await multi.balanceOf(alice.address,10)).to.equal(17n);
    expect(await escrow.reserved1155(multi.target,10)).to.equal(0n);
  });
  it('allows independent refunds to each depositor while paused', async function () {
    await pair(); await escrow.pause();
    await expect(escrow.connect(bob).acceptTrade(1)).to.be.revertedWithCustomError(escrow,'EnforcedPause');
    await escrow.connect(bob).cancelTrade(1);
    await expect(escrow.connect(stranger).refundNFT(1,0,0,stranger.address)).to.be.revertedWith('DEPOSITOR_ONLY');
    await escrow.refundNFT(1,0,0,alice.address);
    await escrow.connect(bob).refundNFT(1,1,0,bob.address);
    await expect(escrow.refundNFT(1,0,0,alice.address)).to.be.revertedWith('NOT_DEPOSITED');
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect(await nft.ownerOf(2)).to.equal(bob.address);
  });
  it('refunds every NFT on the caller side and leaves the other side in escrow', async function () {
    await nft.mint(alice.address, 3);
    await nft.mint(bob.address, 4);
    await create([item(nft.target, 1), item(nft.target, 3)], [item(nft.target, 2), item(nft.target, 4)]);
    await deposit(alice, 1, 0, 1, 0);
    await deposit(alice, 3, 0, 1, 1);
    await deposit(bob, 2, 1, 1, 0);
    await ethers.provider.send('evm_increaseTime', [3601]);
    await ethers.provider.send('evm_mine', []);
    await escrow.refundMySide(1, alice.address);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect(await nft.ownerOf(3)).to.equal(alice.address);
    expect(await nft.ownerOf(2)).to.equal(escrow.target);
    expect(await nft.ownerOf(4)).to.equal(bob.address);
    await expect(escrow.connect(stranger).refundMySide(1, stranger.address)).to.be.revertedWith('DEPOSITOR_ONLY');
  });
  it('expires automatically on refund and credits offered ETH only once', async function () {
    await create([item(nft.target,1)], [], 100);
    await deposit(alice,1,0);
    await ethers.provider.send('evm_increaseTime',[3601]); await ethers.provider.send('evm_mine',[]);
    await expect(escrow.connect(bob).acceptTrade(1)).to.be.revertedWith('TRADE_EXPIRED');
    await escrow.refundNFT(1,0,0,alice.address);
    expect(await escrow.ethCredit(alice.address)).to.equal(100n);
    await expect(escrow.cancelTrade(1)).to.be.revertedWith('NOT_PENDING');
    await escrow.withdrawETH(alice.address);
    expect(await ethers.provider.getBalance(escrow.target)).to.equal(0n);
  });
  it('pins fees, accounts for both ETH sides, and leaves no balance after withdrawals', async function () {
    await escrow.setTradeFee(10);
    await create([item(nft.target,1)], [], 100, 200, bob.address, 110);
    await escrow.setTradeFee(20); await deposit(alice,1,0);
    await expect(escrow.connect(bob).acceptTrade(1,{value:220})).to.be.revertedWith('INCORRECT_ETH_VALUE');
    await escrow.connect(bob).acceptTrade(1,{value:210});
    expect(await escrow.ethCredit(alice.address)).to.equal(200n);
    expect(await escrow.ethCredit(bob.address)).to.equal(100n);
    expect(await escrow.ethCredit(collector.address)).to.equal(20n);
    for (const who of [alice,bob,collector]) await escrow.connect(who).withdrawETH(who.address);
    expect(await ethers.provider.getBalance(escrow.target)).to.equal(0n);
  });
  it('rejects invalid terms, duplicates, and the same asset on both sides', async function () {
    const a = item(nft.target,1);
    await expect(create([],[])).to.be.revertedWith('EMPTY_TRADE');
    await expect(create([a,a],[])).to.be.revertedWith('DUPLICATE_ITEM');
    await expect(create([a],[a])).to.be.revertedWith('ASSET_ON_BOTH_SIDES');
    await expect(create([item(nft.target,1,2)],[])).to.be.revertedWith('INVALID_ERC721_AMOUNT');
    await expect(create([item(stranger.address,1)],[])).to.be.revertedWith('INVALID_ITEM');
    await expect(create(Array(9).fill(a),[])).to.be.revertedWith('TOO_MANY_ITEMS');
    await expect(create([a],[],0,0,alice.address)).to.be.revertedWith('INVALID_COUNTERPARTY');
  });
  it('rolls back settlement if a receiving wallet rejects and allows cancellation/refund', async function () {
    const wallet = await (await ethers.getContractFactory('EscrowTestWallet')).deploy();
    await create([item(nft.target,1)],[],100,0,wallet.target);
    await deposit(alice,1,0);
    await wallet.configure(true,false,ethers.ZeroAddress,'0x');
    await expect(wallet.execute(escrow.target,escrow.interface.encodeFunctionData('acceptTrade',[1]))).to.be.revertedWith('REJECT_NFT');
    expect((await escrow.trades(1)).status).to.equal(0n);
    expect(await escrow.ethCredit(wallet.target)).to.equal(0n);
    expect(await nft.ownerOf(1)).to.equal(escrow.target);
    await escrow.cancelTrade(1); await escrow.refundNFT(1,0,0,alice.address);
  });
  it('rejects receiver reentrancy during settlement', async function () {
    const wallet = await (await ethers.getContractFactory('EscrowTestWallet')).deploy();
    await create([item(nft.target,1)],[],0,0,wallet.target); await deposit(alice,1,0);
    await wallet.configure(false,false,escrow.target,escrow.interface.encodeFunctionData('cancelTrade',[1]));
    await wallet.execute(escrow.target,escrow.interface.encodeFunctionData('acceptTrade',[1]));
    expect(await wallet.reentrySucceeded()).to.equal(false);
    expect((await escrow.trades(1)).status).to.equal(1n);
  });
  it('keeps ETH credits recoverable when a wallet rejects ETH', async function () {
    const wallet = await (await ethers.getContractFactory('EscrowTestWallet')).deploy();
    await create([],[],100,0,wallet.target);
    await wallet.execute(escrow.target,escrow.interface.encodeFunctionData('acceptTrade',[1]));
    await wallet.configure(false,true,ethers.ZeroAddress,'0x');
    await expect(wallet.execute(escrow.target,escrow.interface.encodeFunctionData('withdrawETH',[wallet.target]))).to.be.revertedWith('ETH_TRANSFER_FAILED');
    expect(await escrow.ethCredit(wallet.target)).to.equal(100n);
    await wallet.execute(escrow.target,escrow.interface.encodeFunctionData('withdrawETH',[bob.address]));
    expect(await escrow.ethCredit(wallet.target)).to.equal(0n);
  });
  it('a collection blocking withdrawals cannot hold other collections or ETH refunds hostage', async function () {
    await create([item(nft.target,1), item(multi.target,10,2,1)],[],100);
    await deposit(alice,1,0);
    await multi.safeTransferFrom(alice.address,escrow.target,10,2,data(1,0,1));
    await nft.setBlocked(true);
    await escrow.cancelTrade(1);
    await expect(escrow.refundNFT(1,0,0,alice.address)).to.be.revertedWith('COLLECTION_BLOCKED');
    await escrow.refundNFT(1,0,1,alice.address); await escrow.withdrawETH(alice.address);
    expect(await escrow.deposited(1,0,0)).to.equal(true);
    await nft.setBlocked(false); await escrow.refundNFT(1,0,0,alice.address);
  });
  it('does not expose admin seizure and restricts admin configuration', async function () {
    await expect(escrow.connect(stranger).pause()).to.be.revertedWithCustomError(escrow,'OwnableUnauthorizedAccount');
    await expect(escrow.setTradeFee(ethers.parseEther('0.02'))).to.be.revertedWith('FEE_TOO_HIGH');
    await escrow.transferOwnership(bob.address);
    expect(await escrow.owner()).to.equal(alice.address);
    await escrow.connect(bob).acceptOwnership(); expect(await escrow.owner()).to.equal(bob.address);
  });
  it('rolls back the first NFT transfer if the second collection refuses settlement', async function () {
    const second = await (await ethers.getContractFactory('OwnerDirectNFT')).deploy();
    await second.mint(bob.address,9);
    await create([item(nft.target,1)],[item(second.target,9)],100,50);
    await deposit(alice,1,0);
    await second.connect(bob)['safeTransferFrom(address,address,uint256,bytes)'](bob.address,escrow.target,9,data(1,1,0));
    await second.setBlocked(true);
    await expect(escrow.connect(bob).acceptTrade(1,{value:50})).to.be.revertedWith('COLLECTION_BLOCKED');
    expect(await nft.ownerOf(1)).to.equal(escrow.target);
    expect(await escrow.deposited(1,0,0)).to.equal(true);
    expect(await escrow.reserved721(nft.target,1)).to.equal(1n);
    expect(await escrow.ethCredit(alice.address)).to.equal(0n);
    expect(await ethers.provider.getBalance(escrow.target)).to.equal(100n);
    await escrow.cancelTrade(1); await escrow.refundNFT(1,0,0,alice.address);
  });
  it('rejects late deposits, paused deposits, and unknown callback senders', async function () {
    await create([item(nft.target,1)],[]);
    await expect(escrow.onERC721Received(alice.address,alice.address,1,data(1,0,0))).to.be.revertedWith('WRONG_ASSET');
    await escrow.pause();
    await expect(deposit(alice,1,0)).to.be.revertedWithCustomError(escrow,'EnforcedPause');
    await escrow.unpause();
    await ethers.provider.send('evm_increaseTime',[3601]); await ethers.provider.send('evm_mine',[]);
    await expect(deposit(alice,1,0)).to.be.revertedWith('TRADE_EXPIRED');
    await escrow.connect(stranger).expireTrade(1);
    expect((await escrow.trades(1)).status).to.equal(3n);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
  });
  it('settles the maximum eight NFTs per side', async function () {
    const offered=[],requested=[];
    for(let i=0;i<8;i++){
      await nft.mint(alice.address,100+i);await nft.mint(bob.address,200+i);
      offered.push(item(nft.target,100+i));requested.push(item(nft.target,200+i));
    }
    await create(offered,requested);
    for(let i=0;i<8;i++){await deposit(alice,100+i,0,1,i);await deposit(bob,200+i,1,1,i);}
    await escrow.connect(bob).acceptTrade(1);
    for(let i=0;i<8;i++){expect(await nft.ownerOf(100+i)).to.equal(bob.address);expect(await nft.ownerOf(200+i)).to.equal(alice.address);}
  });
  it('rejects batch deposits and invalid duration/payment', async function () {
    await create([item(multi.target,10,2,1)],[]);
    // OpenZeppelin dispatches one-element batches to the single-item hook.
    await expect(multi.safeBatchTransferFrom(alice.address,escrow.target,[10,10],[1,1],data(1,0,0))).to.be.revertedWith('USE_SINGLE_DEPOSITS');
    await expect(escrow.createTrade(bob.address,[],[],1,0,0,{value:1})).to.be.revertedWith('INVALID_DURATION');
    await expect(create([],[],100,0,bob.address,99)).to.be.revertedWith('INCORRECT_ETH_VALUE');
  });
});
