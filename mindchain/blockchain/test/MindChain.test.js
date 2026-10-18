import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const randomId = () => ethers.hexlify(ethers.randomBytes(32));
const digestOf = (s) => ethers.sha256(ethers.toUtf8Bytes(s));
const ZERO32 = ethers.ZeroHash;

async function deployFixture() {
  const [patient, therapist, otherTherapist, stranger] = await ethers.getSigners();
  const mindChain = await ethers.deployContract("MindChain");
  return { mindChain, patient, therapist, otherTherapist, stranger };
}

async function registeredFixture() {
  const f = await deployFixture();
  await f.mindChain.connect(f.patient).registerPatient();
  return f;
}

async function withRecordFixture() {
  const f = await registeredFixture();
  const recordId = randomId();
  const digest = digestOf("record-v1");
  await f.mindChain.connect(f.patient).registerRecord(recordId, digest);
  return { ...f, recordId, digest };
}

describe("MindChain", function () {
  describe("patient registration", function () {
    it("registers a patient and emits PatientRegistered", async function () {
      const { mindChain, patient } = await loadFixture(deployFixture);
      expect(await mindChain.isRegisteredPatient(patient.address)).to.equal(false);
      await expect(mindChain.connect(patient).registerPatient()).to.emit(mindChain, "PatientRegistered");
      expect(await mindChain.isRegisteredPatient(patient.address)).to.equal(true);
      expect(await mindChain.patientRegisteredAt(patient.address)).to.be.greaterThan(0n);
    });

    it("rejects double registration", async function () {
      const { mindChain, patient } = await loadFixture(registeredFixture);
      await expect(mindChain.connect(patient).registerPatient()).to.be.revertedWithCustomError(
        mindChain,
        "AlreadyRegistered",
      );
    });
  });

  describe("consent: grant and revoke", function () {
    it("lets a registered patient grant access without expiry", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      await expect(mindChain.connect(patient).grantAccess(therapist.address, 0))
        .to.emit(mindChain, "AccessGranted")
        .withArgs(patient.address, therapist.address, 0);
      expect(await mindChain.hasAccess(patient.address, therapist.address)).to.equal(true);
      const g = await mindChain.getGrant(patient.address, therapist.address);
      expect(g.active).to.equal(true);
      expect(g.currentlyValid).to.equal(true);
    });

    it("scopes grants to a specific patient-therapist pair", async function () {
      const { mindChain, patient, therapist, otherTherapist, stranger } = await loadFixture(registeredFixture);
      await mindChain.connect(patient).grantAccess(therapist.address, 0);
      expect(await mindChain.hasAccess(patient.address, otherTherapist.address)).to.equal(false);
      expect(await mindChain.hasAccess(stranger.address, therapist.address)).to.equal(false);
    });

    it("revokes access and emits AccessRevoked", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      await mindChain.connect(patient).grantAccess(therapist.address, 0);
      await expect(mindChain.connect(patient).revokeAccess(therapist.address))
        .to.emit(mindChain, "AccessRevoked")
        .withArgs(patient.address, therapist.address);
      expect(await mindChain.hasAccess(patient.address, therapist.address)).to.equal(false);
    });

    it("allows re-granting after revocation", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      await mindChain.connect(patient).grantAccess(therapist.address, 0);
      await mindChain.connect(patient).revokeAccess(therapist.address);
      await mindChain.connect(patient).grantAccess(therapist.address, 0);
      expect(await mindChain.hasAccess(patient.address, therapist.address)).to.equal(true);
    });

    it("expires time-limited grants", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      const expiresAt = (await time.latest()) + 3600;
      await mindChain.connect(patient).grantAccess(therapist.address, expiresAt);
      expect(await mindChain.hasAccess(patient.address, therapist.address)).to.equal(true);
      await time.increaseTo(expiresAt);
      expect(await mindChain.hasAccess(patient.address, therapist.address)).to.equal(false);
      const g = await mindChain.getGrant(patient.address, therapist.address);
      expect(g.active).to.equal(true);
      expect(g.currentlyValid).to.equal(false);
    });

    it("rejects grants from unregistered wallets", async function () {
      const { mindChain, stranger, therapist } = await loadFixture(registeredFixture);
      await expect(mindChain.connect(stranger).grantAccess(therapist.address, 0)).to.be.revertedWithCustomError(
        mindChain,
        "NotRegisteredPatient",
      );
    });

    it("rejects zero-address and self grants", async function () {
      const { mindChain, patient } = await loadFixture(registeredFixture);
      await expect(mindChain.connect(patient).grantAccess(ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(
        mindChain,
        "InvalidTherapist",
      );
      await expect(mindChain.connect(patient).grantAccess(patient.address, 0)).to.be.revertedWithCustomError(
        mindChain,
        "InvalidTherapist",
      );
    });

    it("rejects an expiry in the past", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      const past = (await time.latest()) - 1;
      await expect(mindChain.connect(patient).grantAccess(therapist.address, past)).to.be.revertedWithCustomError(
        mindChain,
        "InvalidExpiry",
      );
    });

    it("rejects revoking a grant that is not active", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      await expect(mindChain.connect(patient).revokeAccess(therapist.address)).to.be.revertedWithCustomError(
        mindChain,
        "NoActiveGrant",
      );
    });

    it("does not let a therapist or a stranger revoke or grant on a patient's behalf", async function () {
      const { mindChain, patient, therapist, stranger } = await loadFixture(registeredFixture);
      await mindChain.connect(patient).grantAccess(therapist.address, 0);
      // The therapist is not a registered patient, so cannot act at all.
      await expect(mindChain.connect(therapist).revokeAccess(therapist.address)).to.be.revertedWithCustomError(
        mindChain,
        "NotRegisteredPatient",
      );
      // A stranger who registers only controls their own grants.
      await mindChain.connect(stranger).registerPatient();
      await expect(mindChain.connect(stranger).revokeAccess(therapist.address)).to.be.revertedWithCustomError(
        mindChain,
        "NoActiveGrant",
      );
      expect(await mindChain.hasAccess(patient.address, therapist.address)).to.equal(true);
    });
  });

  describe("record registration and verification", function () {
    it("registers a record digest and emits RecordRegistered", async function () {
      const { mindChain, patient } = await loadFixture(registeredFixture);
      const recordId = randomId();
      const digest = digestOf("hello");
      await expect(mindChain.connect(patient).registerRecord(recordId, digest))
        .to.emit(mindChain, "RecordRegistered")
        .withArgs(recordId, patient.address, digest, 1);
      const r = await mindChain.getRecord(recordId);
      expect(r.owner).to.equal(patient.address);
      expect(r.digest).to.equal(digest);
      expect(r.version).to.equal(1n);
      expect(r.revoked).to.equal(false);
      expect(await mindChain.recordExists(recordId)).to.equal(true);
    });

    it("verifies matching digests and rejects mismatches", async function () {
      const { mindChain, recordId, digest } = await loadFixture(withRecordFixture);
      expect(await mindChain.verifyRecord(recordId, digest)).to.equal(true);
      expect(await mindChain.verifyRecord(recordId, digestOf("tampered"))).to.equal(false);
      expect(await mindChain.verifyRecord(randomId(), digest)).to.equal(false);
    });

    it("rejects registration by unregistered wallets", async function () {
      const { mindChain, stranger } = await loadFixture(registeredFixture);
      await expect(
        mindChain.connect(stranger).registerRecord(randomId(), digestOf("x")),
      ).to.be.revertedWithCustomError(mindChain, "NotRegisteredPatient");
    });

    it("rejects zero record ids, zero digests and duplicate ids", async function () {
      const { mindChain, patient, recordId } = await loadFixture(withRecordFixture);
      await expect(mindChain.connect(patient).registerRecord(ZERO32, digestOf("x"))).to.be.revertedWithCustomError(
        mindChain,
        "InvalidRecordId",
      );
      await expect(mindChain.connect(patient).registerRecord(randomId(), ZERO32)).to.be.revertedWithCustomError(
        mindChain,
        "InvalidDigest",
      );
      await expect(mindChain.connect(patient).registerRecord(recordId, digestOf("y"))).to.be.revertedWithCustomError(
        mindChain,
        "RecordAlreadyExists",
      );
    });

    it("prevents another patient from claiming an existing record id", async function () {
      const { mindChain, stranger, recordId, patient } = await loadFixture(withRecordFixture);
      await mindChain.connect(stranger).registerPatient();
      await expect(mindChain.connect(stranger).registerRecord(recordId, digestOf("z"))).to.be.revertedWithCustomError(
        mindChain,
        "RecordAlreadyExists",
      );
      expect((await mindChain.getRecord(recordId)).owner).to.equal(patient.address);
    });

    it("reverts getRecord for unknown ids", async function () {
      const { mindChain } = await loadFixture(registeredFixture);
      await expect(mindChain.getRecord(randomId())).to.be.revertedWithCustomError(mindChain, "RecordNotFound");
    });
  });

  describe("record updates and revocation", function () {
    it("lets the owner update the digest and bumps the version", async function () {
      const { mindChain, patient, recordId, digest } = await loadFixture(withRecordFixture);
      const newDigest = digestOf("record-v2");
      await expect(mindChain.connect(patient).updateRecord(recordId, newDigest))
        .to.emit(mindChain, "RecordUpdated")
        .withArgs(recordId, patient.address, newDigest, 2);
      expect(await mindChain.verifyRecord(recordId, newDigest)).to.equal(true);
      expect(await mindChain.verifyRecord(recordId, digest)).to.equal(false);
      expect((await mindChain.getRecord(recordId)).version).to.equal(2n);
    });

    it("rejects updates by non-owners, unknown ids, zero and unchanged digests", async function () {
      const { mindChain, patient, therapist, recordId, digest } = await loadFixture(withRecordFixture);
      await expect(mindChain.connect(therapist).updateRecord(recordId, digestOf("evil"))).to.be.revertedWithCustomError(
        mindChain,
        "NotRecordOwner",
      );
      await expect(mindChain.connect(patient).updateRecord(randomId(), digestOf("x"))).to.be.revertedWithCustomError(
        mindChain,
        "RecordNotFound",
      );
      await expect(mindChain.connect(patient).updateRecord(recordId, ZERO32)).to.be.revertedWithCustomError(
        mindChain,
        "InvalidDigest",
      );
      await expect(mindChain.connect(patient).updateRecord(recordId, digest)).to.be.revertedWithCustomError(
        mindChain,
        "DigestUnchanged",
      );
    });

    it("lets the owner revoke a record, after which it no longer verifies or updates", async function () {
      const { mindChain, patient, recordId, digest } = await loadFixture(withRecordFixture);
      await expect(mindChain.connect(patient).revokeRecord(recordId))
        .to.emit(mindChain, "RecordRevoked")
        .withArgs(recordId, patient.address);
      expect(await mindChain.verifyRecord(recordId, digest)).to.equal(false);
      expect((await mindChain.getRecord(recordId)).revoked).to.equal(true);
      await expect(mindChain.connect(patient).updateRecord(recordId, digestOf("v2"))).to.be.revertedWithCustomError(
        mindChain,
        "RecordIsRevoked",
      );
      await expect(mindChain.connect(patient).revokeRecord(recordId)).to.be.revertedWithCustomError(
        mindChain,
        "RecordIsRevoked",
      );
    });

    it("rejects revocation by non-owners", async function () {
      const { mindChain, stranger, recordId } = await loadFixture(withRecordFixture);
      await expect(mindChain.connect(stranger).revokeRecord(recordId)).to.be.revertedWithCustomError(
        mindChain,
        "NotRecordOwner",
      );
    });
  });

  describe("privacy", function () {
    it("exposes only addresses, random ids and digests in events", async function () {
      const { mindChain, patient, therapist } = await loadFixture(registeredFixture);
      await mindChain.connect(patient).grantAccess(therapist.address, 0);
      const recordId = randomId();
      await mindChain.connect(patient).registerRecord(recordId, digestOf("x"));
      for (const fragment of mindChain.interface.fragments.filter((f) => f.type === "event")) {
        for (const input of fragment.inputs) {
          expect(["address", "bytes32", "uint32", "uint64"]).to.include(input.type, `${fragment.name}.${input.name}`);
        }
      }
    });
  });
});
