import bs58 from 'bs58';
import {Buffer} from 'buffer';
import nacl from 'tweetnacl';
import {expect} from 'chai';

import {Connection} from '../src/connection';
import {Keypair} from '../src/keypair';
import {PublicKey} from '../src/publickey';
import {Transaction, TransactionInstruction} from '../src/transaction';
import {StakeProgram} from '../src/stake-program';
import {SystemProgram} from '../src/system-program';
import {Message} from '../src/message';
import invariant from '../src/util/assert';
import {toBuffer} from '../src/util/to-buffer';
import {helpers} from './mocks/rpc-http';
import {url} from './url';

describe('Transaction', () => {
  describe('compileMessage', () => {
    it('accountKeys are ordered', () => {
      const payer = Keypair.generate();
      const accountRegular2 = new PublicKey(2);
      const accountRegular3 = new PublicKey(3);
      const accountWritable4 = new PublicKey(4);
      const accountWritable5 = new PublicKey(5);
      const accountSigner6 = new PublicKey(6);
      const accountSigner7 = new PublicKey(7);
      const accountWritableSigner8 = new PublicKey(8);
      const accountWritableSigner9 = new PublicKey(9);

      const recentBlockhash = Keypair.generate().publicKey.toBase58();
      const programId = Keypair.generate().publicKey;
      const transaction = new Transaction({
        blockhash: recentBlockhash,
        lastValidBlockHeight: 9999,
      }).add({
        keys: [
          // Regular accounts
          {pubkey: accountRegular3, isSigner: false, isWritable: false},
          {pubkey: accountRegular2, isSigner: false, isWritable: false},
          // Writable accounts
          {pubkey: accountWritable5, isSigner: false, isWritable: true},
          {pubkey: accountWritable4, isSigner: false, isWritable: true},
          // Signers
          {pubkey: accountSigner7, isSigner: true, isWritable: false},
          {pubkey: accountSigner6, isSigner: true, isWritable: false},
          // Writable Signers
          {pubkey: accountWritableSigner9, isSigner: true, isWritable: true},
          {pubkey: accountWritableSigner8, isSigner: true, isWritable: true},
          // Payer.
          {pubkey: payer.publicKey, isSigner: true, isWritable: true},
        ],
        programId,
      });

      transaction.feePayer = payer.publicKey;

      const message = transaction.compileMessage();
      // Payer comes first.
      expect(message.accountKeys[0].equals(payer.publicKey)).to.be.true;
      // Writable signers come next, in pubkey order.
      expect(message.accountKeys[1].equals(accountWritableSigner8)).to.be.true;
      expect(message.accountKeys[2].equals(accountWritableSigner9)).to.be.true;
      // Signers come next, in pubkey order.
      expect(message.accountKeys[3].equals(accountSigner6)).to.be.true;
      expect(message.accountKeys[4].equals(accountSigner7)).to.be.true;
      // Writable accounts come next, in pubkey order.
      expect(message.accountKeys[5].equals(accountWritable4)).to.be.true;
      expect(message.accountKeys[6].equals(accountWritable5)).to.be.true;
      // Everything else afterward, in pubkey order.
      expect(message.accountKeys[7].equals(accountRegular2)).to.be.true;
      expect(message.accountKeys[8].equals(accountRegular3)).to.be.true;
      expect(message.accountKeys[9].equals(programId)).to.be.true;
    });

    it('accountKeys collapses signedness and writability of duplicate accounts', () => {
      const payer = Keypair.generate();
      const account2 = new PublicKey(2);
      const account3 = new PublicKey(3);
      const account4 = new PublicKey(4);
      const account5 = new PublicKey(5);

      const recentBlockhash = Keypair.generate().publicKey.toBase58();
      const programId = Keypair.generate().publicKey;
      const transaction = new Transaction({
        blockhash: recentBlockhash,
        lastValidBlockHeight: 9999,
      }).add({
        keys: [
          // Should sort last.
          {pubkey: account5, isSigner: false, isWritable: false},
          {pubkey: account5, isSigner: false, isWritable: false},
          // Should be considered writeable.
          {pubkey: account4, isSigner: false, isWritable: false},
          {pubkey: account4, isSigner: false, isWritable: true},
          // Should be considered a signer.
          {pubkey: account3, isSigner: false, isWritable: false},
          {pubkey: account3, isSigner: true, isWritable: false},
          // Should be considered a writable signer.
          {pubkey: account2, isSigner: false, isWritable: true},
          {pubkey: account2, isSigner: true, isWritable: false},
          // Payer.
          {pubkey: payer.publicKey, isSigner: true, isWritable: true},
        ],
        programId,
      });

      transaction.feePayer = payer.publicKey;

      const message = transaction.compileMessage();
      // Payer comes first.
      expect(message.accountKeys[0].equals(payer.publicKey)).to.be.true;
      // Writable signer comes first.
      expect(message.accountKeys[1].equals(account2)).to.be.true;
      // Signer comes next.
      expect(message.accountKeys[2].equals(account3)).to.be.true;
      // Writable account comes next.
      expect(message.accountKeys[3].equals(account4)).to.be.true;
      // Regular accounts come last.
      expect(message.accountKeys[4].equals(account5)).to.be.true;
      expect(message.accountKeys[5].equals(programId)).to.be.true;
    });

    it('payer is first account meta', () => {
      const payer = Keypair.generate();
      const other = Keypair.generate();
      const recentBlockhash = Keypair.generate().publicKey.toBase58();
      const programId = Keypair.generate().publicKey;
      const transaction = new Transaction({
        blockhash: recentBlockhash,
        lastValidBlockHeight: 9999,
      }).add({
        keys: [
          {pubkey: other.publicKey, isSigner: true, isWritable: true},
          {pubkey: payer.publicKey, isSigner: true, isWritable: true},
        ],
        programId,
      });

      transaction.sign(payer, other);
      const message = transaction.compileMessage();
      expect(message.accountKeys[0]).to.eql(payer.publicKey);
      expect(message.accountKeys[1]).to.eql(other.publicKey);
      expect(message.header.numRequiredSignatures).to.eq(2);
      expect(message.header.numReadonlySignedAccounts).to.eq(0);
      expect(message.header.numReadonlyUnsignedAccounts).to.eq(1);
    });

    it('validation', () => {
      const payer = Keypair.generate();
      const recentBlockhash = Keypair.generate().publicKey.toBase58();

      const transaction = new Transaction();
      expect(() => {
        transaction.compileMessage();
      }).to.throw('Transaction recentBlockhash required');

      transaction.recentBlockhash = recentBlockhash;

      expect(() => {
        transaction.compileMessage();
      }).to.throw('Transaction fee payer required');

      transaction.setSigners(payer.publicKey, Keypair.generate().publicKey);

      expect(() => {
        transaction.compileMessage();
      }).to.throw('unknown signer');

      // Expect compile to succeed with implicit fee payer from signers
      transaction.setSigners(payer.publicKey);
      transaction.compileMessage();

      // Expect compile to succeed with fee payer and no signers
      transaction.signatures = [];
      transaction.feePayer = payer.publicKey;
      transaction.compileMessage();
    });

    it('payer is writable', () => {
      const payer = Keypair.generate();
      const recentBlockhash = Keypair.generate().publicKey.toBase58();
      const programId = Keypair.generate().publicKey;
      const transaction = new Transaction({
        blockhash: recentBlockhash,
        lastValidBlockHeight: 9999,
      }).add({
        keys: [{pubkey: payer.publicKey, isSigner: true, isWritable: false}],
        programId,
      });

      transaction.sign(payer);
      const message = transaction.compileMessage();
      expect(message.accountKeys[0]).to.eql(payer.publicKey);
      expect(message.header.numRequiredSignatures).to.eq(1);
      expect(message.header.numReadonlySignedAccounts).to.eq(0);
      expect(message.header.numReadonlyUnsignedAccounts).to.eq(1);
    });
  });

  if (process.env.TEST_LIVE) {
    it('getEstimatedFee', async () => {
      const connection = new Connection(url);
      const accountFrom = Keypair.generate();
      const accountTo = Keypair.generate();

      const latestBlockhash = await helpers.latestBlockhash({connection});

      const transaction = new Transaction({
        feePayer: accountFrom.publicKey,
        ...latestBlockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: accountFrom.publicKey,
          toPubkey: accountTo.publicKey,
          lamports: 10,
        }),
      );

      const fee = await transaction.getEstimatedFee(connection);
      expect(fee).to.eq(5000);
    });
  }

  it('partialSign', () => {
    const account1 = Keypair.generate();
    const account2 = Keypair.generate();
    const recentBlockhash = account1.publicKey.toBase58(); // Fake recentBlockhash
    const transfer = SystemProgram.transfer({
      fromPubkey: account1.publicKey,
      toPubkey: account2.publicKey,
      lamports: 123,
    });

    const transaction = new Transaction({
      blockhash: recentBlockhash,
      lastValidBlockHeight: 9999,
    }).add(transfer);
    transaction.sign(account1, account2);

    const partialTransaction = new Transaction({
      blockhash: recentBlockhash,
      lastValidBlockHeight: 9999,
    }).add(transfer);
    partialTransaction.setSigners(account1.publicKey, account2.publicKey);
    expect(partialTransaction.signatures[0].signature).to.be.null;
    expect(partialTransaction.signatures[1].signature).to.be.null;

    partialTransaction.partialSign(account1);
    expect(partialTransaction.signatures[0].signature).not.to.be.null;
    expect(partialTransaction.signatures[1].signature).to.be.null;

    expect(() => partialTransaction.serialize()).to.throw();
    expect(() =>
      partialTransaction.serialize({requireAllSignatures: false}),
    ).not.to.throw();

    partialTransaction.partialSign(account2);

    expect(partialTransaction.signatures[0].signature).not.to.be.null;
    expect(partialTransaction.signatures[1].signature).not.to.be.null;

    expect(() => partialTransaction.serialize()).not.to.throw();

    expect(partialTransaction).to.eql(transaction);

    invariant(partialTransaction.signatures[0].signature);
    partialTransaction.signatures[0].signature[0] = 0;
    expect(() =>
      partialTransaction.serialize({requireAllSignatures: false}),
    ).to.throw();
    expect(() =>
      partialTransaction.serialize({
        verifySignatures: false,
        requireAllSignatures: false,
      }),
    ).not.to.throw();
  });

  describe('dedupe', () => {
    const payer = Keypair.generate();
    const duplicate1 = payer;
    const duplicate2 = payer;
    const recentBlockhash = Keypair.generate().publicKey.toBase58();
    const programId = Keypair.generate().publicKey;

    it('setSigners', () => {
      const transaction = new Transaction({
        blockhash: recentBlockhash,
        lastValidBlockHeight: 9999,
      }).add({
        keys: [
          {pubkey: duplicate1.publicKey, isSigner: true, isWritable: true},
          {pubkey: payer.publicKey, isSigner: false, isWritable: true},
          {pubkey: duplicate2.publicKey, isSigner: true, isWritable: false},
        ],
        programId,
      });

      transaction.setSigners(
        payer.publicKey,
        duplicate1.publicKey,
        duplicate2.publicKey,
      );

      expect(transaction.signatures).to.have.length(1);
      expect(transaction.signatures[0].publicKey).to.eql(payer.publicKey);

      const message = transaction.compileMessage();
      expect(message.accountKeys[0]).to.eql(payer.publicKey);
      expect(message.header.numRequiredSignatures).to.eq(1);
      expect(message.header.numReadonlySignedAccounts).to.eq(0);
      expect(message.header.numReadonlyUnsignedAccounts).to.eq(1);

      transaction.signatures;
    });

    it('sign', () => {
      const transaction = new Transaction({
        blockhash: recentBlockhash,
        lastValidBlockHeight: 9999,
      }).add({
        keys: [
          {pubkey: duplicate1.publicKey, isSigner: true, isWritable: true},
          {pubkey: payer.publicKey, isSigner: false, isWritable: true},
          {pubkey: duplicate2.publicKey, isSigner: true, isWritable: false},
        ],
        programId,
      });

      transaction.sign(payer, duplicate1, duplicate2);

      expect(transaction.signatures).to.have.length(1);
      expect(transaction.signatures[0].publicKey).to.eql(payer.publicKey);

      const message = transaction.compileMessage();
      expect(message.accountKeys[0]).to.eql(payer.publicKey);
      expect(message.header.numRequiredSignatures).to.eq(1);
      expect(message.header.numReadonlySignedAccounts).to.eq(0);
      expect(message.header.numReadonlyUnsignedAccounts).to.eq(1);

      transaction.signatures;
    });
  });

  it('transfer signatures', () => {
    const account1 = Keypair.generate();
    const account2 = Keypair.generate();
    const recentBlockhash = account1.publicKey.toBase58(); // Fake recentBlockhash
    const transfer1 = SystemProgram.transfer({
      fromPubkey: account1.publicKey,
      toPubkey: account2.publicKey,
      lamports: 123,
    });
    const transfer2 = SystemProgram.transfer({
      fromPubkey: account2.publicKey,
      toPubkey: account1.publicKey,
      lamports: 123,
    });

    const latestBlockhash = {
      blockhash: recentBlockhash,
      lastValidBlockHeight: 9999,
    };

    const orgTransaction = new Transaction({
      ...latestBlockhash,
    }).add(transfer1, transfer2);
    orgTransaction.sign(account1, account2);

    const newTransaction = new Transaction({
      ...latestBlockhash,
      signatures: orgTransaction.signatures,
    }).add(transfer1, transfer2);

    expect(newTransaction).to.eql(orgTransaction);
  });

  it('dedup signatures', () => {
    const account1 = Keypair.generate();
    const account2 = Keypair.generate();
    const recentBlockhash = account1.publicKey.toBase58(); // Fake recentBlockhash
    const transfer1 = SystemProgram.transfer({
      fromPubkey: account1.publicKey,
      toPubkey: account2.publicKey,
      lamports: 123,
    });
    const transfer2 = SystemProgram.transfer({
      fromPubkey: account1.publicKey,
      toPubkey: account2.publicKey,
      lamports: 123,
    });

    const orgTransaction = new Transaction({
      blockhash: recentBlockhash,
      lastValidBlockHeight: 9999,
    }).add(transfer1, transfer2);
    orgTransaction.sign(account1);
  });

  it('use nonce', () => {
    const account1 = Keypair.generate();
    const account2 = Keypair.generate();
    const nonceAccount = Keypair.generate();
    const nonce = account2.publicKey.toBase58(); // Fake Nonce hash

    const nonceInfo = {
      nonce,
      nonceInstruction: SystemProgram.nonceAdvance({
        noncePubkey: nonceAccount.publicKey,
        authorizedPubkey: account1.publicKey,
      }),
    };

    const transferTransaction = new Transaction({nonceInfo}).add(
      SystemProgram.transfer({
        fromPubkey: account1.publicKey,
        toPubkey: account2.publicKey,
        lamports: 123,
      }),
    );
    transferTransaction.sign(account1);

    let expectedData = Buffer.alloc(4);
    expectedData.writeInt32LE(4, 0);

    expect(transferTransaction.instructions).to.have.length(2);
    expect(transferTransaction.instructions[0].programId).to.eql(
      SystemProgram.programId,
    );
    expect(transferTransaction.instructions[0].data).to.eql(expectedData);
    expect(transferTransaction.recentBlockhash).to.eq(nonce);

    const stakeAccount = Keypair.generate();
    const voteAccount = Keypair.generate();
    const stakeTransaction = new Transaction({nonceInfo}).add(
      StakeProgram.delegate({
        stakePubkey: stakeAccount.publicKey,
        authorizedPubkey: account1.publicKey,
        votePubkey: voteAccount.publicKey,
      }),
    );
    stakeTransaction.sign(account1);

    expect(stakeTransaction.instructions).to.have.length(2);
    expect(stakeTransaction.instructions[0].programId).to.eql(
      SystemProgram.programId,
    );
    expect(stakeTransaction.instructions[0].data).to.eql(expectedData);
    expect(stakeTransaction.recentBlockhash).to.eq(nonce);
  });

  it('parse wire format and serialize', () => {
    const sender = Keypair.fromSeed(Uint8Array.from(Array(32).fill(8))); // Arbitrary known account
    const recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k'; // Arbitrary known recentBlockhash
    const recipient = new PublicKey(
      'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99',
    ); // Arbitrary known public key
    const transfer = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: 49,
    });
    const expectedTransaction = new Transaction({
      blockhash: recentBlockhash,
      feePayer: sender.publicKey,
      lastValidBlockHeight: 9999,
    }).add(transfer);
    expectedTransaction.sign(sender);

    const serializedTransaction = Buffer.from(
      'AVuErQHaXv0SG0/PchunfxHKt8wMRfMZzqV0tkC5qO6owYxWU2v871AoWywGoFQr4z+q/7mE8lIufNl/kxj+nQ0BAAEDE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8r9Q5/Mtmcn8onFxt47xKj+XdXXd3C8j/FcPu7csUrz/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxJrndgN4IFTxep3s6kO0ROug7bEsbx0xxuDkqEvwUusBAgIAAQwCAAAAMQAAAAAAAAA=',
      'base64',
    );
    const deserializedTransaction = Transaction.from(serializedTransaction);

    expect(expectedTransaction.serialize()).to.eql(serializedTransaction);
    expect(deserializedTransaction.serialize()).to.eql(serializedTransaction);
  });

  it('populate transaction', () => {
    const recentBlockhash = new PublicKey(1).toString();
    const message = {
      accountKeys: [
        new PublicKey(1).toString(),
        new PublicKey(2).toString(),
        new PublicKey(3).toString(),
        new PublicKey(4).toString(),
        new PublicKey(5).toString(),
      ],
      header: {
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 3,
        numRequiredSignatures: 2,
      },
      instructions: [
        {
          accounts: [1, 2, 3],
          data: bs58.encode(Buffer.alloc(5).fill(9)),
          programIdIndex: 4,
        },
      ],
      recentBlockhash,
    };

    const signatures = [
      bs58.encode(Buffer.alloc(64).fill(1)),
      bs58.encode(Buffer.alloc(64).fill(2)),
    ];

    const transaction = Transaction.populate(new Message(message), signatures);
    expect(transaction.instructions).to.have.length(1);
    expect(transaction.signatures).to.have.length(2);
    expect(transaction.recentBlockhash).to.eq(recentBlockhash);
  });

  it('populate then compile transaction', () => {
    const recentBlockhash = new PublicKey(1).toString();
    const message = new Message({
      accountKeys: [
        new PublicKey(1).toString(),
        new PublicKey(2).toString(),
        new PublicKey(3).toString(),
        new PublicKey(4).toString(),
        new PublicKey(5).toString(),
      ],
      header: {
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 3,
        numRequiredSignatures: 2,
      },
      instructions: [
        {
          accounts: [1, 2, 3],
          data: bs58.encode(Buffer.alloc(5).fill(9)),
          programIdIndex: 2,
        },
      ],
      recentBlockhash,
    });

    const signatures = [
      bs58.encode(Buffer.alloc(64).fill(1)),
      bs58.encode(Buffer.alloc(64).fill(2)),
    ];

    const transaction = Transaction.populate(message, signatures);
    const compiledMessage = transaction.compileMessage();
    expect(compiledMessage).to.eql(message);

    // show that without caching the message, the populated message
    // might not be the same when re-compiled
    transaction._message = undefined;
    const compiledMessage2 = transaction.compileMessage();
    expect(compiledMessage2).not.to.eql(message);

    // show that even if message is cached, transaction may still
    // be modified
    transaction._message = message;
    transaction.recentBlockhash = new PublicKey(100).toString();
    const compiledMessage3 = transaction.compileMessage();
    expect(compiledMessage3).not.to.eql(message);
  });

  it('constructs a transaction with last valid block height', () => {
    const blockhash = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
    const lastValidBlockHeight = 1234;
    const transaction = new Transaction({
      blockhash,
      lastValidBlockHeight,
    });
    expect(transaction.recentBlockhash).to.eq(blockhash);
    expect(transaction.lastValidBlockHeight).to.eq(lastValidBlockHeight);
  });

  it('constructs a transaction with only a recent blockhash', () => {
    const recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
    const transaction = new Transaction({
      recentBlockhash,
    });
    expect(transaction.recentBlockhash).to.eq(recentBlockhash);
    expect(transaction.lastValidBlockHeight).to.be.undefined;
  });

  it('serialize unsigned transaction', () => {
    const sender = Keypair.fromSeed(Uint8Array.from(Array(32).fill(8))); // Arbitrary known account
    const recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k'; // Arbitrary known recentBlockhash
    const recipient = new PublicKey(
      'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99',
    ); // Arbitrary known public key
    const transfer = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: 49,
    });
    const expectedTransaction = new Transaction({
      blockhash: recentBlockhash,
      lastValidBlockHeight: 9999,
    }).add(transfer);

    // Empty signature array fails.
    expect(expectedTransaction.signatures).to.have.length(0);
    expect(() => {
      expectedTransaction.serialize();
    }).to.throw('Transaction fee payer required');
    expect(() => {
      expectedTransaction.serialize({verifySignatures: false});
    }).to.throw('Transaction fee payer required');
    expect(() => {
      expectedTransaction.serializeMessage();
    }).to.throw('Transaction fee payer required');

    expectedTransaction.feePayer = sender.publicKey;

    // Transactions with missing signatures will fail sigverify.
    expect(() => {
      expectedTransaction.serialize();
    }).to.throw('Signature verification failed');

    // Serializing without signatures is allowed if sigverify disabled.
    expectedTransaction.serialize({verifySignatures: false});

    // Serializing the message is allowed when signature array has null signatures
    expectedTransaction.serializeMessage();

    expectedTransaction.feePayer = undefined;
    expectedTransaction.setSigners(sender.publicKey);
    expect(expectedTransaction.signatures).to.have.length(1);

    // Transactions with missing signatures will fail sigverify.
    expect(() => {
      expectedTransaction.serialize();
    }).to.throw('Signature verification failed');

    // Serializing without signatures is allowed if sigverify disabled.
    expectedTransaction.serialize({verifySignatures: false});

    // Serializing the message is allowed when signature array has null signatures
    expectedTransaction.serializeMessage();

    const expectedSerializationWithNoSignatures = Buffer.from(
      'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAABAAEDE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8r9' +
        'Q5/Mtmcn8onFxt47xKj+XdXXd3C8j/FcPu7csUrz/AAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAxJrndgN4IFTxep3s6kO0ROug7bEsbx0xxuDkqEvwUusBAgIAAQwC' +
        'AAAAMQAAAAAAAAA=',
      'base64',
    );
    expect(expectedTransaction.serialize({requireAllSignatures: false})).to.eql(
      expectedSerializationWithNoSignatures,
    );

    // Properly signed transaction succeeds
    expectedTransaction.partialSign(sender);
    expect(expectedTransaction.signatures).to.have.length(1);
    const expectedSerialization = Buffer.from(
      'AVuErQHaXv0SG0/PchunfxHKt8wMRfMZzqV0tkC5qO6owYxWU2v871AoWywGoFQr4z+q/7mE8lIufNl/' +
        'kxj+nQ0BAAEDE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8r9Q5/Mtmcn8onFxt47xKj+XdXX' +
        'd3C8j/FcPu7csUrz/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxJrndgN4IFTxep3s6kO0' +
        'ROug7bEsbx0xxuDkqEvwUusBAgIAAQwCAAAAMQAAAAAAAAA=',
      'base64',
    );
    expect(expectedTransaction.serialize()).to.eql(expectedSerialization);
    expect(expectedTransaction.signatures).to.have.length(1);
  });

  it('deprecated - externally signed stake delegate', () => {
    const authority = Keypair.fromSeed(Uint8Array.from(Array(32).fill(1)));
    const stake = new PublicKey(2);
    const recentBlockhash = new PublicKey(3).toBuffer();
    const vote = new PublicKey(4);
    var tx = StakeProgram.delegate({
      stakePubkey: stake,
      authorizedPubkey: authority.publicKey,
      votePubkey: vote,
    });
    const from = authority;
    tx.recentBlockhash = bs58.encode(recentBlockhash);
    tx.setSigners(from.publicKey);
    const tx_bytes = tx.serializeMessage();
    const signature = nacl.sign.detached(tx_bytes, from.secretKey);
    tx.addSignature(from.publicKey, toBuffer(signature));
    expect(tx.verifySignatures()).to.be.true;
  });

  it('externally signed stake delegate', () => {
    const authority = Keypair.fromSeed(Uint8Array.from(Array(32).fill(1)));
    const stake = new PublicKey(2);
    const recentBlockhash = new PublicKey(3).toBuffer();
    const vote = new PublicKey(4);
    var tx = StakeProgram.delegate({
      stakePubkey: stake,
      authorizedPubkey: authority.publicKey,
      votePubkey: vote,
    });
    const from = authority;
    tx.recentBlockhash = bs58.encode(recentBlockhash);
    tx.feePayer = from.publicKey;
    const tx_bytes = tx.serializeMessage();
    const signature = nacl.sign.detached(tx_bytes, from.secretKey);
    tx.addSignature(from.publicKey, toBuffer(signature));
    expect(tx.verifySignatures()).to.be.true;
  });

  it('can serialize, deserialize, and reserialize with a partial signer', () => {
    const signer = Keypair.generate();
    const acc0Writable = Keypair.generate();
    const acc1Writable = Keypair.generate();
    const acc2Writable = Keypair.generate();
    const t0 = new Transaction({
      blockhash: 'HZaTsZuhN1aaz9WuuimCFMyH7wJ5xiyMUHFCnZSMyguH',
      feePayer: signer.publicKey,
      lastValidBlockHeight: 9999,
    });
    t0.add(
      new TransactionInstruction({
        keys: [
          {
            pubkey: signer.publicKey,
            isWritable: true,
            isSigner: true,
          },
          {
            pubkey: acc0Writable.publicKey,
            isWritable: true,
            isSigner: false,
          },
        ],
        programId: Keypair.generate().publicKey,
      }),
    );
    t0.add(
      new TransactionInstruction({
        keys: [
          {
            pubkey: acc1Writable.publicKey,
            isWritable: false,
            isSigner: false,
          },
        ],
        programId: Keypair.generate().publicKey,
      }),
    );
    t0.add(
      new TransactionInstruction({
        keys: [
          {
            pubkey: acc2Writable.publicKey,
            isWritable: true,
            isSigner: false,
          },
        ],
        programId: Keypair.generate().publicKey,
      }),
    );
    t0.add(
      new TransactionInstruction({
        keys: [
          {
            pubkey: signer.publicKey,
            isWritable: true,
            isSigner: true,
          },
          {
            pubkey: acc0Writable.publicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: acc2Writable.publicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: acc1Writable.publicKey,
            isWritable: true,
            isSigner: false,
          },
        ],
        programId: Keypair.generate().publicKey,
      }),
    );
    const t1 = Transaction.from(t0.serialize({requireAllSignatures: false}));
    t1.partialSign(signer);
    t1.serialize();
  });
});
